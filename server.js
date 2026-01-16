const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');
const { Record, Dialog, Op, initDB } = require('./db');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'fitopharm_secret_key',
    resave: false,
    saveUninitialized: true
}));

initDB();

function checkAuth(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

app.get('/', checkAuth, async (req, res) => {
    const { period, sortType, startDate, endDate } = req.query;
    let whereClause = {};
    const today = moment().format('YYYY-MM-DD');
    const activePeriod = period || (startDate ? '' : 'today');

    if (startDate && endDate) {
        whereClause.date = {
            [Op.between]: [startDate, endDate]
        };
    } else {
        if (activePeriod === 'today') {
            whereClause.date = today;
        } else if (activePeriod === 'yesterday') {
            whereClause.date = moment().subtract(1, 'days').format('YYYY-MM-DD');
        } else if (activePeriod === '2days') {
            whereClause.date = { [Op.gte]: moment().subtract(2, 'days').format('YYYY-MM-DD') };
        } else if (activePeriod === 'week') {
            whereClause.date = { [Op.gte]: moment().subtract(7, 'days').format('YYYY-MM-DD') };
        } else if (activePeriod === 'month') {
            whereClause.date = { [Op.gte]: moment().subtract(1, 'months').format('YYYY-MM-DD') };
        } else if (activePeriod === '6months') {
            whereClause.date = { [Op.gte]: moment().subtract(6, 'months').format('YYYY-MM-DD') };
        } else if (activePeriod === 'year') {
            whereClause.date = { [Op.gte]: moment().subtract(1, 'years').format('YYYY-MM-DD') };
        }
    }

    try {
        const recordsRaw = await Record.findAll({ 
            where: whereClause,
            include: [Dialog]
        });

        const viewData = recordsRaw.map(rec => {
            const plainRec = rec.get({ plain: true });
            plainRec.sales = plainRec.Dialogs.filter(d => d.status === 'sales').length;
            plainRec.refusals = plainRec.Dialogs.filter(d => d.status === 'refusals').length;
            plainRec.unknown = plainRec.Dialogs.filter(d => d.status === 'unknown').length;
            return plainRec;
        });

        if (sortType === 'sales') {
            viewData.sort((a, b) => b.sales - a.sales);
        } else if (sortType === 'refusals') {
            viewData.sort((a, b) => b.refusals - a.refusals);
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
        res.status(500).send("Ошибка сервера");
    }
});

app.get('/details/:id', checkAuth, async (req, res) => {
    try {
        const { startDate, endDate, type, dialogId } = req.query;
        const recordId = req.params.id;

        const itemRaw = await Record.findByPk(recordId);
        if (!itemRaw) return res.redirect('/');
        
        const allDialogs = await Dialog.findAll({ where: { RecordId: recordId } });

        const item = itemRaw.get({ plain: true });
        item.sales = allDialogs.filter(d => d.status === 'sales').length;
        item.refusals = allDialogs.filter(d => d.status === 'refusals').length;
        item.unknown = allDialogs.filter(d => d.status === 'unknown').length;

        let dialogWhere = { RecordId: recordId };
        if (type) {
            dialogWhere.status = type;
        }

        const dialogues = await Dialog.findAll({
            where: dialogWhere
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
            currentRange: currentRange
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Ошибка при загрузке деталей");
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin') {
        req.session.isAuthenticated = true;
        res.redirect('/');
    } else {
        res.render('login', { error: 'Неверный пароль' });
    }
});

app.listen(3000, () => {
    console.log('Server started on port 3000');
});