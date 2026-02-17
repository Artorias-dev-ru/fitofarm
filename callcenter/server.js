const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const moment = require('moment');
const cron = require('node-cron');
const ftp = require("basic-ftp");
const { Call, User, Note, Setting, Op, sequelize, initDB } = require('./db');
const { runSync, getSyncStatus } = require('./sync');

const app = express();
app.set('trust proxy', 1);
const BASE_URL = process.env.BASE_URL || '/callcenter';

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
app.use(BASE_URL + '/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    name: 'callcenter_sid',
    secret: 'callcenter_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { path: BASE_URL, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
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
        } catch (e) {}
    }
    next();
});

function checkAuth(req, res, next) {
    if (req.user) return next();
    res.redirect(BASE_URL + '/login');
}

function checkSuperAdmin(req, res, next) {
    if (req.user && req.user.role === 'superadmin') return next();
    res.status(403).send('Доступ запрещен');
}

function getDateWhere(period, startDate, endDate) {
    if (startDate && endDate) return { [Op.between]: [startDate, endDate] };
    if (period === 'today') return moment().format('YYYY-MM-DD');
    if (period === 'yesterday') return moment().subtract(1, 'days').format('YYYY-MM-DD');
    if (period === 'week') return { [Op.gte]: moment().subtract(7, 'days').format('YYYY-MM-DD') };
    if (period === 'month') return { [Op.gte]: moment().subtract(1, 'months').format('YYYY-MM-DD') };
    if (period === 'year') return { [Op.gte]: moment().subtract(1, 'years').format('YYYY-MM-DD') };
    return { [Op.not]: null }; 
}

app.get(BASE_URL + '/', checkAuth, async (req, res) => {
    const { period, startDate, endDate, view } = req.query;
    try {
        const dateWhere = getDateWhere(period || 'month', startDate, endDate);
        const calls = await Call.findAll({ 
            where: { date: dateWhere },
            order: [['date', 'DESC'], ['time', 'DESC']]
        });
        const aggressionCount = calls.filter(c => c.rudeness > 0.5).length;
        const noHelloCount = calls.filter(c => !c.said_hello).length;
        const totalViolationsCount = calls.filter(c => c.rudeness > 0.5 || !c.said_hello).length;
        const totalCount = calls.length || 1;
        const chartStats = await Call.findAll({
            where: { date: dateWhere },
            attributes: [
                'date',
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_calls'],
                [sequelize.literal("SUM(CASE WHEN said_hello = 0 OR rudeness > 0.5 THEN 1 ELSE 0 END)"), 'violations'],
                [sequelize.literal("SUM(CASE WHEN said_hello = 0 THEN 1 ELSE 0 END)"), 'no_hello'],
                [sequelize.literal("SUM(CASE WHEN rudeness > 0.5 THEN 1 ELSE 0 END)"), 'aggression']
            ],
            group: ['date'],
            order: [['date', 'ASC']]
        });
        const chartLabels = [];
        const series = { calls: [], violations: [], no_hello: [], aggression: [] };
        chartStats.forEach(item => {
            chartLabels.push(moment(item.getDataValue('date')).format('DD.MM'));
            series.calls.push(item.getDataValue('total_calls') || 0);
            series.violations.push(item.getDataValue('violations') || 0);
            series.no_hello.push(item.getDataValue('no_hello') || 0);
            series.aggression.push(item.getDataValue('aggression') || 0);
        });
        const groupedByDate = {};
        calls.forEach(c => {
            if (!groupedByDate[c.date]) groupedByDate[c.date] = { date: c.date, count: 0, activities: new Set(), firstId: c.id };
            groupedByDate[c.date].count++;
            if (c.rudeness > 0.5) { groupedByDate[c.date].activities.add('грубая ошибка'); groupedByDate[c.date].activities.add('агрессия'); }
            if (!c.said_hello) groupedByDate[c.date].activities.add('приветствие');
        });
        const listData = Object.values(groupedByDate).sort((a, b) => new Date(b.date) - new Date(a.date));
        const settings = await Setting.findAll();
        const config = {};
        settings.forEach(s => config[s.key] = parseInt(s.value));
        res.render('dashboard', {
            stats: { total: calls.length, violations: totalViolationsCount, rudeness: aggressionCount, hello: noHelloCount, p_violations: (totalViolationsCount/totalCount)*100, p_rudeness: (aggressionCount/totalCount)*100, p_hello: (noHelloCount/totalCount)*100 },
            chart: { labels: JSON.stringify(chartLabels), datasets: JSON.stringify(series) },
            activePeriod: period || 'month', currentView: view || 'analytics', currentRange: startDate && endDate ? `${startDate} to ${endDate}` : '', listData, moment, config
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.get(BASE_URL + '/details/:id', checkAuth, async (req, res) => {
    const { status, activity } = req.query;
    try {
        let currentCall;
        if (req.params.id.endsWith('_redir')) {
            const targetDate = req.query.date;
            let redirWhere = { date: targetDate };
            if (status && status !== 'all') redirWhere.status = status;
            if (activity === 'грубая ошибка') redirWhere[Op.or] = [{ rudeness: { [Op.gt]: 0.5 } }, { said_hello: false }];
            else if (activity === 'агрессия') redirWhere.rudeness = { [Op.gt]: 0.5 };
            else if (activity === 'отсутствие приветствия') redirWhere.said_hello = false;

            currentCall = await Call.findOne({ where: redirWhere, order: [['time', 'DESC']] });
            if (!currentCall) currentCall = await Call.findOne({ where: { date: targetDate }, order: [['time', 'DESC']] });
            if (!currentCall) return res.redirect(BASE_URL + '/');
            return res.redirect(`${BASE_URL}/details/${currentCall.id}?status=${status || 'all'}&activity=${activity || 'все звонки'}`);
        }

        currentCall = await Call.findByPk(req.params.id, { include: [{ model: User, as: 'Processor' }] });
        if (!currentCall) return res.redirect(BASE_URL + '/');

        const sidebarDates = await Call.findAll({
            attributes: ['date', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
            group: ['date'],
            order: [['date', 'DESC']],
            raw: true
        });

        let dayWhere = { date: currentCall.date };
        if (status && status !== 'all') dayWhere.status = status;
        if (activity === 'грубая ошибка') dayWhere[Op.or] = [{ rudeness: { [Op.gt]: 0.5 } }, { said_hello: false }];
        else if (activity === 'агрессия') dayWhere.rudeness = { [Op.gt]: 0.5 };
        else if (activity === 'отсутствие приветствия') dayWhere.said_hello = false;

        const currentDayCalls = await Call.findAll({
            where: dayWhere,
            order: [['time', 'DESC']]
        });

        const userNote = await Note.findOne({ where: { CallId: currentCall.id, UserId: req.user.id } });
        res.render('details', { currentCall, sidebarDates, currentDayCalls, userNote, moment, currentStatusFilter: status || 'all', currentActivityFilter: activity || 'все звонки' });
    } catch (err) { res.status(500).send(err.message); }
});

app.get(BASE_URL + '/api/audio/:id', checkAuth, async (req, res) => {
    const client = new ftp.Client();
    try {
        const call = await Call.findByPk(req.params.id);
        if (!call || !call.audioUrl) return res.status(404).send("File not found");
        await client.access({
            host: process.env.FTP_HOST,
            port: parseInt(process.env.FTP_PORT),
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS
        });
        res.setHeader('Content-Type', 'audio/wav');
        await client.downloadTo(res, call.audioUrl);
    } catch (e) {
        if (!res.headersSent) res.status(500).send(e.message);
    } finally {
        client.close();
    }
});

app.get(BASE_URL + '/my-notes', checkAuth, async (req, res) => {
    try {
        let where = {};
        if (req.user.role !== 'superadmin') where.UserId = req.user.id;
        const notes = await Note.findAll({ where, include: [Call, User], order: [['updatedAt', 'DESC']] });
        res.render('my_notes', { notes, moment });
    } catch (err) { res.status(500).send(err.message); }
});

app.post(BASE_URL + '/api/notes', checkAuth, async (req, res) => {
    const { callId, content } = req.body;
    try {
        const [note, created] = await Note.findOrCreate({ where: { CallId: callId, UserId: req.user.id }, defaults: { content } });
        if (!created) { note.content = content; await note.save(); }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get(BASE_URL + '/admin/users', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const users = await User.findAll({ where: { role: 'admin' } });
        res.render('admin', { users });
    } catch (err) { res.status(500).send(err.message); }
});

app.post(BASE_URL + '/admin/create-user', checkAuth, checkSuperAdmin, async (req, res) => {
    const { fullName, email, password } = req.body;
    try {
        await User.create({ fullName, email, username: email, password, role: 'admin', avatar: '/public/avatar1.png' });
        res.redirect(BASE_URL + '/admin/users');
    } catch (err) { res.status(500).send(err.message); }
});

app.post(BASE_URL + '/api/user/profile', checkAuth, upload.single('avatar'), async (req, res) => {
    const { fullName } = req.body;
    try {
        const updateData = { fullName };
        if (req.file) updateData.avatar = BASE_URL + '/public/uploads/' + req.file.filename;
        await User.update(updateData, { where: { id: req.user.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post(BASE_URL + '/api/settings', checkAuth, async (req, res) => {
    try {
        await Setting.update({ value: req.body.threshold_low.toString() }, { where: { key: 'threshold_low' } });
        await Setting.update({ value: req.body.threshold_high.toString() }, { where: { key: 'threshold_high' } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post(BASE_URL + '/api/calls/:id/result', checkAuth, async (req, res) => {
    try {
        await Call.update({ status: req.body.status, manualResult: req.body.manualResult, processedById: req.user.id }, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post(BASE_URL + '/api/sync/start', checkAuth, (req, res) => {
    if (getSyncStatus()) return res.json({ success: false });
    runSync().catch(e => {});
    res.json({ success: true });
});

app.get(BASE_URL + '/login', (req, res) => { res.render('login', { error: null }); });
app.post(BASE_URL + '/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const user = await User.findOne({ where: { [Op.or]: [{ username: login }, { email: login }] } });
        if (user && user.password === password) { req.session.userId = user.id; res.redirect(BASE_URL + '/'); }
        else res.render('login', { error: 'Неверные учетные данные' });
    } catch (err) { res.render('login', { error: 'Ошибка сервера' }); }
});

app.get(BASE_URL + '/logout', (req, res) => { req.session.destroy(); res.redirect(BASE_URL + '/login'); });

initDB().then(() => {
    cron.schedule('0 9 * * *', () => runSync().catch(e => {}));
    app.listen(3000, '0.0.0.0', () => console.log('Server started'));
});