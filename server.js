const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');
const { Record, Dialog, Op, initDB } = require('./db');

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

function checkAuth(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect(BASE_URL + '/login');
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
        await Dialog.update({ note: note }, { where: { id: dialogId } });
        res.json({ success: true });
    } catch (err) {
        console.error("Error saving note:", err);
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
            currentRange: currentRange
        });
    } catch (err) {
        console.error(err);
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

        const currentRange = startDate && endDate ? `${startDate} to ${endDate}` : '';

        res.render('details', {
            item: item,
            dialogues: dialogues,
            activeDialog: activeDialog,
            activeType: type || '',
            currentRange: currentRange,
            activeTab: tab || 'summary' 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading details: " + err.message);
    }
});

app.get(BASE_URL + '/login', (req, res) => {
    res.render('login', { error: null });
});

app.post(BASE_URL + '/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin') {
        req.session.isAuthenticated = true;
        res.redirect(BASE_URL + '/');
    } else {
        res.render('login', { error: 'Invalid login or password' });
    }
});

console.log("Waiting for data load...");
initDB().then(() => {
    app.listen(3000, () => {
        console.log('Server started on port 3000 (Data fully loaded)');
    });
}).catch(err => {
    console.error("DB Initialization Error:", err);
    app.listen(3000, () => {
        console.log('Server started on port 3000 (With DB Errors)');
    });
});