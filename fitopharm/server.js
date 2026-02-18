const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');
const ftp = require("basic-ftp"); 
const cron = require('node-cron');
const { Record, Dialog, User, Note, Op, initDB } = require('./db');
const { runSync, getSyncStatus } = require('./sync');

const app = express();

app.set('trust proxy', 1);

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
    name: 'fitopharm_sid',
    secret: 'fitopharm_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        path: '/',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(async (req, res, next) => {
    res.locals.baseUrl = BASE_URL;
    res.locals.user = null;
    res.locals.isSyncing = getSyncStatus();

    if (req.session && req.session.userId) {
        try {
            const user = await User.findByPk(req.session.userId);
            if (user) {
                res.locals.user = user.toJSON(); 
                req.user = user; 
            }
        } catch (e) {
            console.error(e);
        }
    }
    next();
});

function checkAuth(req, res, next) {
    if (req.user) {
        return next();
    }
    res.redirect(BASE_URL + '/login');
}

function getDateWhere(period, startDate, endDate) {
    const today = moment().format('YYYY-MM-DD');
    if (startDate && endDate) return { [Op.between]: [startDate, endDate] };
    if (period === 'today') return today;
    if (period === 'yesterday') return moment().subtract(1, 'days').format('YYYY-MM-DD');
    if (period === '2days') return { [Op.gte]: moment().subtract(1, 'days').format('YYYY-MM-DD') }; 
    if (period === 'week') return { [Op.gte]: moment().subtract(7, 'days').format('YYYY-MM-DD') };
    if (period === 'month') return { [Op.gte]: moment().subtract(1, 'months').format('YYYY-MM-DD') };
    if (period === '6months') return { [Op.gte]: moment().subtract(6, 'months').format('YYYY-MM-DD') };
    if (period === 'year') return { [Op.gte]: moment().subtract(1, 'years').format('YYYY-MM-DD') };
    return { [Op.not]: null }; 
}

app.post(BASE_URL + '/api/sync/start', checkAuth, (req, res) => {
    if (getSyncStatus()) {
        return res.json({ success: false, message: 'Process running' });
    }
    runSync()
        .then(() => console.log('Manual sync completed'))
        .catch(e => console.error(e));
        
    res.json({ success: true });
});

app.get(BASE_URL + '/', checkAuth, async (req, res) => {
    const { period, sortType, startDate, endDate } = req.query;
    try {
        const recordsRaw = await Record.findAll({ 
            include: [{ model: Dialog, required: false }]
        });
        const viewData = recordsRaw.map(rec => {
            const plainRec = rec.get({ plain: true });
            const allDialogs = plainRec.Dialogs || [];
            const filtered = allDialogs.filter(d => {
                const today = moment().format('YYYY-MM-DD');
                if (startDate && endDate) return d.date >= startDate && d.date <= endDate;
                if (period === 'today') return d.date === today;
                if (period === 'yesterday') return d.date === moment().subtract(1, 'days').format('YYYY-MM-DD');
                if (period === 'week') return d.date >= moment().subtract(7, 'days').format('YYYY-MM-DD');
                if (period === 'month') return d.date >= moment().subtract(1, 'months').format('YYYY-MM-DD');
                if (period === 'year') return d.date >= moment().subtract(1, 'years').format('YYYY-MM-DD');
                return true;
            });
            plainRec.Dialogs = filtered; 
            plainRec.globalDialogs = allDialogs; 
            plainRec.sales = filtered.filter(d => d.status === 'sales').length;
            plainRec.refusals = filtered.filter(d => d.status === 'refusals').length;
            plainRec.unknown = filtered.filter(d => d.status === 'unknown').length;
            return plainRec;
        });
        if (sortType === 'sales') viewData.sort((a, b) => b.sales - a.sales);
        else if (sortType === 'refusals') viewData.sort((a, b) => b.refusals - a.refusals);
        else viewData.sort((a, b) => a.address.localeCompare(b.address));
        res.render('dashboard', {
            data: viewData,
            activeSort: sortType || 'alphabet',
            activePeriod: period || (startDate ? '' : 'year'),
            currentRange: startDate && endDate ? `${startDate} to ${endDate}` : ''
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get(BASE_URL + '/details/:id', checkAuth, async (req, res) => {
    try {
        const { startDate, endDate, type, dialogId, period, tab } = req.query;
        const recordId = req.params.id;
        const dateWhere = getDateWhere(period || (startDate ? '' : 'year'), startDate, endDate);
        let listWhere = { RecordId: recordId, date: dateWhere };
        if (type) listWhere.status = type;
        const itemRaw = await Record.findByPk(recordId);
        if (!itemRaw) return res.redirect(BASE_URL + '/');
        const allDialogs = await Dialog.findAll({ where: { RecordId: recordId, date: dateWhere } });
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
            activeDialog = dialogId ? dialogues.find(d => d.id == dialogId) : dialogues[0];
        }
        if (activeDialog) {
            const notes = await Note.findAll({
                where: { DialogId: activeDialog.id, UserId: req.user.id },
                order: [['createdAt', 'DESC']] 
            });
            activeDialog.notes = notes; 
        }
        res.render('details', {
            item: item,
            dialogues: dialogues,
            activeDialog: activeDialog,
            activeType: type || '',
            currentRange: startDate && endDate ? `${startDate} to ${endDate}` : '',
            activeTab: tab || 'summary',
            activePeriod: period || (startDate ? '' : 'year') 
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get(BASE_URL + '/my-notes', checkAuth, async (req, res) => {
    try {
        const notes = await Note.findAll({
            where: { UserId: req.user.id },
            include: [{ model: Dialog, include: [Record] }],
            order: [['updatedAt', 'DESC']]
        });
        res.render('my-notes', { notes });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post(BASE_URL + '/api/note/edit', checkAuth, async (req, res) => {
    try {
        const { noteId, content } = req.body;
        const note = await Note.findOne({ where: { id: noteId, UserId: req.user.id } });
        if (note) {
            note.content = content;
            await note.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post(BASE_URL + '/api/note/delete', checkAuth, async (req, res) => {
    try {
        const { noteId } = req.body;
        await Note.destroy({ where: { id: noteId, UserId: req.user.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get(BASE_URL + '/api/audio/:id', checkAuth, async (req, res) => {
    const client = new ftp.Client();
    try {
        const dialog = await Dialog.findByPk(req.params.id);
        if (!dialog || !dialog.audioUrl) return res.status(404).send('Not found');

        const remoteFilePath = path.posix.join(dialog.folderPath, dialog.audioUrl);
        
        await client.access({
            host: process.env.FTP_HOST,
            port: parseInt(process.env.FTP_PORT),
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });
        
        res.setHeader('Content-Type', 'audio/wav');
        await client.downloadTo(res, remoteFilePath);
    } catch (err) {
        if (!res.headersSent) res.status(500).send('FTP Error');
    } finally { client.close(); }
});

app.post(BASE_URL + '/api/save-note', checkAuth, async (req, res) => {
    try {
        const { dialogId, note } = req.body;
        const userId = req.user.id;
        if (note && note.trim() !== '') {
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

app.get(BASE_URL + '/login', (req, res) => { res.render('login', { error: null }); });

app.post(BASE_URL + '/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const user = await User.findOne({ where: { [Op.or]: [{ username: login }, { email: login }] } });
        if (user && user.password === password) {
            req.session.userId = user.id;
            res.redirect(BASE_URL + '/');
        } else {
            res.render('login', { error: 'Invalid credentials' });
        }
    } catch (err) { res.render('login', { error: 'Server error' }); }
});

app.get(BASE_URL + '/logout', (req, res) => { req.session.destroy(); res.redirect(BASE_URL + '/login'); });

app.get(BASE_URL + '/admin', checkAuth, async (req, res) => {
    if (req.user.role !== 'superadmin') return res.status(403).send("Access denied");
    try {
        const users = await User.findAll({ where: { role: { [Op.ne]: 'superadmin' } } });
        res.render('admin', { users, error: null });
    } catch (e) { res.status(500).send(e.message); }
});

app.post(BASE_URL + '/admin/create-user', checkAuth, async (req, res) => {
    if (req.user.role !== 'superadmin') return res.status(403).send("Access denied");
    const { fullName, email, password } = req.body;
    try {
        await User.create({ fullName, email, password, role: 'admin' });
        res.redirect(BASE_URL + '/admin');
    } catch (e) {
        const users = await User.findAll({ where: { role: { [Op.ne]: 'superadmin' } } });
        res.render('admin', { users, error: 'Creation error' });
    }
});

app.post(BASE_URL + '/api/change-password', checkAuth, async (req, res) => {
    const { newPassword } = req.body;
    try {
        const user = await User.findByPk(req.user.id);
        user.password = newPassword;
        await user.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post(BASE_URL + '/api/update-status', checkAuth, async (req, res) => {
    try {
        const { dialogId, status } = req.body;
        const dialog = await Dialog.findByPk(dialogId);
        if (dialog) {
            dialog.status = status;
            await dialog.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.get(BASE_URL + '/api/dev-delete', checkAuth, async (req, res) => {
    const secretToken = "dev123"; 
    const { base, date, t } = req.query;
    if (t !== secretToken) return res.status(403).send('auth_err');
    if (!base || !date) return res.status(400).send('params_err');
    const formattedDate = date.split('-').reverse().join('-');
    try {
        let targetModel;
        let tableName;
        if (base === 'callcenter') {
            return res.status(400).send('cannot_access_callcenter_from_here');
        } else if (base === 'fitofarm') {
            const { Dialog } = require('./db'); 
            targetModel = Dialog;
            tableName = 'Dialogs';
        } else {
            return res.status(404).send('db_not_found');
        }
        const deletedCount = await targetModel.destroy({
            where: { date: formattedDate }
        });
        await targetModel.destroy({
            where: {
                [Op.or]: [
                    { date: null },
                    { date: '' },
                    { date: 'Invalid date' }
                ]
            }
        });
        res.send(`ok|${base}|${tableName}|${formattedDate}|del:${deletedCount}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('db_err');
    }
});

initDB()
    .then(() => {
        cron.schedule('0 9 * * *', () => {
            console.log('Running scheduled sync');
            runSync().catch(e => console.error(e));
        });
        runSync().then(() => console.log('Initial sync running')).catch(e => console.error(e));
        app.listen(3000, '0.0.0.0', () => console.log('Fitopharm Server started'));
    })
    .catch(err => console.error(err));