const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');
const { Record, Dialog, User, Note, Op, initDB } = require('./db');
const { runSync } = require('./sync');

const app = express();

const BASE_URL = process.env.BASE_URL || '';
const DATA_FOLDER = process.env.DATA_FOLDER || 'data';

app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
app.use(BASE_URL + '/public', express.static(path.join(__dirname, 'public')));
app.use(BASE_URL + '/data', express.static(path.join(__dirname, DATA_FOLDER)));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: 'fitopharm_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { path: BASE_URL || '/' }
}));

app.use((req, res, next) => {
    res.locals.baseUrl = BASE_URL;
    next();
});

async function checkAuth(req, res, next) {
    if (req.session.userId) {
        const user = await User.findByPk(req.session.userId);
        if (user) {
            req.user = user;
            res.locals.user = user;
            return next();
        }
    }
    res.redirect(BASE_URL + '/login');
}

function checkSuperAdmin(req, res, next) {
    if (req.user && req.user.role === 'superadmin') {
        next();
    } else {
        res.status(403).send("Доступ запрещен");
    }
}

function getDateWhere(period, startDate, endDate) {
    const today = moment().format('YYYY-MM-DD');
    if (startDate && endDate) {
        return { [Op.between]: [startDate, endDate] };
    }
    if (period === 'today') return today;
    if (period === 'yesterday') return moment().subtract(1, 'days').format('YYYY-MM-DD');
    if (period === '2days') return { [Op.gte]: moment().subtract(1, 'days').format('YYYY-MM-DD') }; 
    if (period === 'week') return { [Op.gte]: moment().subtract(7, 'days').format('YYYY-MM-DD') };
    if (period === 'month') return { [Op.gte]: moment().subtract(1, 'months').format('YYYY-MM-DD') };
    if (period === '6months') return { [Op.gte]: moment().subtract(6, 'months').format('YYYY-MM-DD') };
    if (period === 'year') return { [Op.gte]: moment().subtract(1, 'years').format('YYYY-MM-DD') };
    return { [Op.not]: null }; 
}

app.post(BASE_URL + '/api/save-note', checkAuth, async (req, res) => {
    try {
        const { dialogId, note } = req.body;
        const userId = req.user.id;

        const existingNote = await Note.findOne({
            where: {
                DialogId: dialogId,
                UserId: userId
            }
        });

        if (existingNote) {
            existingNote.content = note;
            await existingNote.save();
        } else {
            await Note.create({
                content: note,
                DialogId: dialogId,
                UserId: userId
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get(BASE_URL + '/', checkAuth, async (req, res) => {
    const { period, sortType, startDate, endDate } = req.query;
    const activePeriod = period || (startDate ? '' : 'year');
    const dateWhere = getDateWhere(activePeriod, startDate, endDate);

    try {
        const recordsRaw = await Record.findAll({ 
            include: [{
                model: Dialog,
                where: { date: dateWhere },
                required: false 
            }]
        });

        const viewData = recordsRaw.map(rec => {
            const plainRec = rec.get({ plain: true });
            if (!plainRec.Dialogs) plainRec.Dialogs = [];
            plainRec.sales = plainRec.Dialogs.filter(d => d.status === 'sales').length;
            plainRec.refusals = plainRec.Dialogs.filter(d => d.status === 'refusals').length;
            plainRec.unknown = plainRec.Dialogs.filter(d => d.status === 'unknown').length;
            return plainRec;
        });

        if (sortType === 'sales') {
            viewData.sort((a, b) => b.sales - a.sales);
        } else if (sortType === 'refusals') {
            viewData.sort((a, b) => b.refusals - a.refusals);
        } else if (sortType === 'unknown') {
            viewData.sort((a, b) => b.unknown - a.unknown);
        } else {
            viewData.sort((a, b) => a.address.localeCompare(b.address));
        }

        const currentRange = startDate && endDate ? `${startDate} to ${endDate}` : '';

        res.render('dashboard', {
            data: viewData,
            activeSort: sortType || 'alphabet',
            activePeriod: activePeriod,
            currentRange: currentRange,
            user: req.user
        });
    } catch (err) {
        res.status(500).send("Server Error: " + err.message);
    }
});

app.get(BASE_URL + '/details/:id', checkAuth, async (req, res) => {
    try {
        const { startDate, endDate, type, dialogId, period, tab } = req.query;
        const recordId = req.params.id;
        
        const activePeriod = period || (startDate ? '' : 'year');
        const dateWhere = getDateWhere(activePeriod, startDate, endDate);

        let listWhere = { RecordId: recordId, date: dateWhere };
        if (type) {
            listWhere.status = type;
        }

        const itemRaw = await Record.findByPk(recordId);
        if (!itemRaw) return res.redirect(BASE_URL + '/');
        
        const allDialogs = await Dialog.findAll({
            where: { RecordId: recordId, date: dateWhere },
            order: [['date', 'ASC'], ['id', 'ASC']] 
        });

        const item = itemRaw.get({ plain: true });
        item.sales = allDialogs.filter(d => d.status === 'sales').length;
        item.refusals = allDialogs.filter(d => d.status === 'refusals').length;
        item.unknown = allDialogs.filter(d => d.status === 'unknown').length;

        const dialogues = await Dialog.findAll({
            where: listWhere,
            order: [['date', 'ASC'], ['startTime', 'ASC'], ['id', 'ASC']] 
        });

        let activeDialog = null;
        if (dialogues.length > 0) {
            if (dialogId) {
                activeDialog = dialogues.find(d => d.id == dialogId);
            }
            if (!activeDialog) {
                activeDialog = dialogues[0];
            }
        }

        let userNote = '';
        if (activeDialog) {
            const noteEntry = await Note.findOne({
                where: {
                    DialogId: activeDialog.id,
                    UserId: req.user.id
                }
            });
            if (noteEntry) userNote = noteEntry.content;
            activeDialog.note = userNote;
        }

        const currentRange = startDate && endDate ? `${startDate} to ${endDate}` : '';

        res.render('details', {
            item: item,
            dialogues: dialogues,
            activeDialog: activeDialog,
            activeType: type || '',
            currentRange: currentRange,
            activeTab: tab || 'summary',
            user: req.user
        });

    } catch (err) {
        res.status(500).send("Error loading details: " + err.message);
    }
});

app.get(BASE_URL + '/login', (req, res) => {
    res.render('login', { error: null });
});

app.post(BASE_URL + '/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        let user;
        if (login === 'admin') {
            user = await User.findOne({ where: { username: 'admin' } });
        } else {
            user = await User.findOne({ where: { email: login } });
        }

        if (user && user.password === password) {
            req.session.userId = user.id;
            res.redirect(BASE_URL + '/');
        } else {
            res.render('login', { error: 'Неверный логин или пароль' });
        }
    } catch (err) {
        res.render('login', { error: 'Ошибка сервера' });
    }
});

app.get(BASE_URL + '/logout', (req, res) => {
    req.session.destroy();
    res.redirect(BASE_URL + '/login');
});

app.get(BASE_URL + '/admin', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const users = await User.findAll({ where: { role: { [Op.ne]: 'superadmin' } } });
        res.render('admin', { users, user: req.user, error: null, success: null });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post(BASE_URL + '/admin/create-user', checkAuth, checkSuperAdmin, async (req, res) => {
    const { fullName, email, password } = req.body;
    try {
        const exists = await User.findOne({ where: { email } });
        if (exists) {
            const users = await User.findAll({ where: { role: { [Op.ne]: 'superadmin' } } });
            return res.render('admin', { users, user: req.user, error: 'Пользователь с таким email уже существует', success: null });
        }
        await User.create({ fullName, email, password, role: 'admin' });
        res.redirect(BASE_URL + '/admin');
    } catch (e) {
        const users = await User.findAll({ where: { role: { [Op.ne]: 'superadmin' } } });
        res.render('admin', { users, user: req.user, error: 'Ошибка создания', success: null });
    }
});

app.get(BASE_URL + '/my-notes', checkAuth, async (req, res) => {
    try {
        const { 
            startDateDialog, endDateDialog, 
            startDateNote, endDateNote, 
            address, status 
        } = req.query;

        const dialogWhere = {};
        const noteWhere = { UserId: req.user.id };
        const recordWhere = {};

        if (startDateDialog && endDateDialog) {
            dialogWhere.date = { [Op.between]: [startDateDialog, endDateDialog] };
        }

        if (startDateNote && endDateNote) {
            const start = moment(startDateNote).startOf('day').toDate();
            const end = moment(endDateNote).endOf('day').toDate();
            noteWhere.updatedAt = { [Op.between]: [start, end] };
        }

        if (status && status !== 'all') {
            dialogWhere.status = status;
        }

        if (address) {
            recordWhere.address = { [Op.like]: `%${address}%` };
        }

        const notes = await Note.findAll({
            where: noteWhere,
            include: [{ 
                model: Dialog, 
                where: dialogWhere,
                include: [{ 
                    model: Record,
                    where: recordWhere
                }] 
            }],
            order: [['updatedAt', 'DESC']]
        });

        const allAddresses = await Record.findAll({
            attributes: ['address'],
            group: ['address']
        });

        res.render('my-notes', { 
            notes, 
            user: req.user,
            filters: req.query,
            addresses: allAddresses.map(r => r.address)
        });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post(BASE_URL + '/api/change-password', checkAuth, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) return res.json({ success: false });
    try {
        const user = await User.findByPk(req.user.id);
        user.password = newPassword;
        await user.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

initDB()
    .then(() => {
        return runSync();
    })
    .then(() => {
        app.listen(3000, () => {
            console.log('Server started on port 3000');
        });
    })
    .catch(err => {
        console.error("Startup Error:", err);
    });