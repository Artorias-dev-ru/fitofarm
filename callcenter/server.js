const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const moment = require('moment');
const cron = require('node-cron');
const ftp = require("basic-ftp");
const { Call, User, Note, Setting, Op, sequelize, initDB, ReadStatus } = require('./db');
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
        const currentView = view || 'analytics';
        const dateWhere = getDateWhere(period || 'month', startDate, endDate);

        const lastSync = await Setting.findOne({ where: { key: 'last_sync_finish' } });
        const syncTime = lastSync ? lastSync.value : moment().subtract(1, 'day').toISOString();

        const newStatsRaw = await Call.findOne({
            where: { createdAt: { [Op.gte]: syncTime } },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
                [sequelize.literal("SUM(CASE WHEN rudeness > 0.5 THEN 1 ELSE 0 END)"), 'rudeness'],
                [sequelize.literal("SUM(CASE WHEN said_hello = 0 THEN 1 ELSE 0 END)"), 'hello'],
                [sequelize.literal("SUM(CASE WHEN politeness < 0.5 THEN 1 ELSE 0 END)"), 'politeness'],
                [sequelize.literal("SUM(CASE WHEN friendliness < 0.5 THEN 1 ELSE 0 END)"), 'friendliness'],
                [sequelize.literal("SUM(CASE WHEN manipulativeness > 0.5 THEN 1 ELSE 0 END)"), 'manipulation'],
                [sequelize.literal("SUM(CASE WHEN (rudeness > 0.5 OR said_hello = 0 OR politeness < 0.5 OR friendliness < 0.5 OR manipulativeness > 0.5) THEN 1 ELSE 0 END)"), 'violations']
            ],
            raw: true
        });

        const summaryStats = await Call.findOne({
            where: { date: dateWhere },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
                [sequelize.literal("SUM(CASE WHEN rudeness > 0.5 THEN 1 ELSE 0 END)"), 'rudeness'],
                [sequelize.literal("SUM(CASE WHEN said_hello = 0 THEN 1 ELSE 0 END)"), 'hello'],
                [sequelize.literal("SUM(CASE WHEN politeness < 0.5 THEN 1 ELSE 0 END)"), 'politeness'],
                [sequelize.literal("SUM(CASE WHEN friendliness < 0.5 THEN 1 ELSE 0 END)"), 'friendliness'],
                [sequelize.literal("SUM(CASE WHEN manipulativeness > 0.5 THEN 1 ELSE 0 END)"), 'manipulation'],
                [sequelize.literal("SUM(CASE WHEN (rudeness > 0.5 OR said_hello = 0 OR politeness < 0.5 OR friendliness < 0.5 OR manipulativeness > 0.5) THEN 1 ELSE 0 END)"), 'violations']
            ],
            raw: true
        });

        const totalCount = parseInt(summaryStats.total) || 0;
        const stats = {
            total: totalCount,
            rudeness: parseInt(summaryStats.rudeness) || 0,
            hello: parseInt(summaryStats.hello) || 0,
            politeness: parseInt(summaryStats.politeness) || 0,
            friendliness: parseInt(summaryStats.friendliness) || 0,
            manipulation: parseInt(summaryStats.manipulation) || 0,
            violations: parseInt(summaryStats.violations) || 0,
            new: {
                total: parseInt(newStatsRaw.total) || 0,
                rudeness: parseInt(newStatsRaw.rudeness) || 0,
                hello: parseInt(newStatsRaw.hello) || 0,
                politeness: parseInt(newStatsRaw.politeness) || 0,
                friendliness: parseInt(newStatsRaw.friendliness) || 0,
                manipulation: parseInt(newStatsRaw.manipulation) || 0,
                violations: parseInt(newStatsRaw.violations) || 0
            }
        };

        const divisor = totalCount || 1;
        stats.p_violations = (stats.violations / divisor) * 100;
        stats.p_rudeness = (stats.rudeness / divisor) * 100;
        stats.p_hello = (stats.hello / divisor) * 100;
        stats.p_politeness = (stats.politeness / divisor) * 100;
        stats.p_friendliness = (stats.friendliness / divisor) * 100;
        stats.p_manipulation = (stats.manipulation / divisor) * 100;

        const allCalls = await Call.findAll({ 
            where: { date: dateWhere },
            order: [['date', 'DESC'], ['time', 'DESC']]
        });

        const groupedByDate = {};
        allCalls.forEach(c => {
            if (!groupedByDate[c.date]) {
                groupedByDate[c.date] = { 
                    date: c.date, 
                    count: 0, 
                    activities: new Set(), 
                    firstId: c.id 
                };
            }
            groupedByDate[c.date].count++;
            if (c.rudeness > 0.5) groupedByDate[c.date].activities.add('агрессия');
            if (c.said_hello === false || c.said_hello === 0) groupedByDate[c.date].activities.add('приветствие');
            if (c.politeness < 0.5) groupedByDate[c.date].activities.add('вежливость');
            if (c.friendliness < 0.5) groupedByDate[c.date].activities.add('дружелюбие');
            if (c.manipulativeness > 0.5) groupedByDate[c.date].activities.add('манипуляция');
        });

        let notesDashWhere = {};
        if (req.user.role !== 'superadmin') notesDashWhere.UserId = req.user.id;
        const latestNotes = await Note.findAll({
            where: notesDashWhere,
            include: [{ model: Call }],
            order: [['createdAt', 'DESC']],
            limit: 4
        });

        const chartStats = await Call.findAll({
            where: { date: dateWhere },
            attributes: [
                'date',
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_calls'],
                [sequelize.literal("SUM(CASE WHEN (said_hello = 0 OR rudeness > 0.5 OR politeness < 0.5 OR friendliness < 0.5 OR manipulativeness > 0.5) THEN 1 ELSE 0 END)"), 'violations'],
                [sequelize.literal("SUM(CASE WHEN said_hello = 0 THEN 1 ELSE 0 END)"), 'no_hello'],
                [sequelize.literal("SUM(CASE WHEN rudeness > 0.5 THEN 1 ELSE 0 END)"), 'aggression'],
                [sequelize.literal("SUM(CASE WHEN politeness < 0.5 THEN 1 ELSE 0 END)"), 'no_politeness'],
                [sequelize.literal("SUM(CASE WHEN friendliness < 0.5 THEN 1 ELSE 0 END)"), 'no_friendliness'],
                [sequelize.literal("SUM(CASE WHEN manipulativeness > 0.5 THEN 1 ELSE 0 END)"), 'manipulation']
            ],
            group: ['date'],
            order: [['date', 'ASC']]
        });

        const chartLabels = [];
        const series = { calls: [], violations: [], no_hello: [], aggression: [], no_politeness: [], no_friendliness: [], manipulation: [] };
        chartStats.forEach(item => {
            chartLabels.push(moment(item.getDataValue('date')).format('DD.MM'));
            series.calls.push(item.getDataValue('total_calls') || 0);
            series.violations.push(item.getDataValue('violations') || 0);
            series.no_hello.push(item.getDataValue('no_hello') || 0);
            series.aggression.push(item.getDataValue('aggression') || 0);
            series.no_politeness.push(item.getDataValue('no_politeness') || 0);
            series.no_friendliness.push(item.getDataValue('no_friendliness') || 0);
            series.manipulation.push(item.getDataValue('manipulation') || 0);
        });

        const settings = await Setting.findAll();
        const config = {};
        settings.forEach(s => config[s.key] = parseInt(s.value));

        let calendarData = { cells: [], days: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'] };
        if (currentView === 'calendar') {
            const calStart = moment().subtract(29, 'days').startOf('day');
            const calEnd = moment().endOf('day');
            const calCalls = await Call.findAll({
                where: { date: { [Op.between]: [calStart.format('YYYY-MM-DD'), calEnd.format('YYYY-MM-DD')] } },
                attributes: ['date', 'said_hello', 'rudeness', 'politeness', 'friendliness', 'manipulativeness']
            });
            const calGrouped = {};
            calCalls.forEach(c => {
                if (!calGrouped[c.date]) calGrouped[c.date] = new Set();
                if (c.rudeness > 0.5) calGrouped[c.date].add('агрессия');
                if (c.said_hello === 0 || c.said_hello === false) calGrouped[c.date].add('приветствие');
                if (c.politeness < 0.5) calGrouped[c.date].add('вежливость');
                if (c.friendliness < 0.5) calGrouped[c.date].add('дружелюбие');
                if (c.manipulativeness > 0.5) calGrouped[c.date].add('манипуляция');
            });
            let iterDate = moment(calStart).startOf('isoWeek');
            const gridEnd = moment(calEnd).endOf('isoWeek');
            while (iterDate.isBefore(gridEnd)) {
                const dStr = iterDate.format('YYYY-MM-DD');
                calendarData.cells.push({
                    date: dStr,
                    dayNum: iterDate.date(),
                    inPeriod: iterDate.isBetween(calStart, calEnd, 'day', '[]'),
                    activities: Array.from(calGrouped[dStr] || [])
                });
                iterDate.add(1, 'day');
            }
        }

        res.render('dashboard', {
            stats,
            chart: { labels: JSON.stringify(chartLabels), datasets: JSON.stringify(series) },
            activePeriod: period || 'month', 
            currentView, 
            currentRange: startDate && endDate ? `${startDate} to ${endDate}` : '', 
            listData: Object.values(groupedByDate).sort((a, b) => new Date(b.date) - new Date(a.date)), 
            calendarData,
            moment, config, latestNotes 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send(err.message); 
    }
});

app.get(BASE_URL + '/details/:id', checkAuth, async (req, res) => {
    const { status, activity, tab } = req.query;
    const userId = req.user.id;

    try {
        if (req.params.id.endsWith('_redir')) {
            const targetDate = req.query.date;
            let redirWhere = { date: targetDate };

            if (status && status !== 'all' && status !== 'без статуса') {
                redirWhere.status = status;
            } else if (status === 'без статуса') {
                redirWhere.status = { [Op.or]: [null, 'без статуса', ''] };
            }

            if (activity === 'грубая ошибка') {
                redirWhere[Op.or] = [
                    { rudeness: { [Op.gt]: 0.5 } }, 
                    { said_hello: false }, 
                    { politeness: { [Op.lt]: 0.5 } }, 
                    { friendliness: { [Op.lt]: 0.5 } }, 
                    { manipulativeness: { [Op.gt]: 0.5 } }
                ];
            } else if (activity === 'агрессия') {
                redirWhere.rudeness = { [Op.gt]: 0.5 };
            } else if (activity === 'отсутствие приветствия') {
                redirWhere.said_hello = false;
            } else if (activity === 'вежливость') {
                redirWhere.politeness = { [Op.lt]: 0.5 };
            } else if (activity === 'дружелюбие') {
                redirWhere.friendliness = { [Op.lt]: 0.5 };
            } else if (activity === 'манипуляция') {
                redirWhere.manipulativeness = { [Op.gt]: 0.5 };
            }

            const redirCall = await Call.findOne({ where: redirWhere, order: [['time', 'DESC']] });
            
            if (!redirCall) {
                const fallbackCall = await Call.findOne({ where: { date: targetDate }, order: [['time', 'DESC']] });
                if (!fallbackCall) return res.redirect(BASE_URL + '/');
                return res.redirect(`${BASE_URL}/details/${fallbackCall.id}?status=all&activity=все звонки${tab ? '&tab=' + tab : ''}`);
            }

            return res.redirect(`${BASE_URL}/details/${redirCall.id}?status=${status || 'all'}&activity=${activity || 'все звонки'}${tab ? '&tab=' + tab : ''}`);
        }

        const currentCall = await Call.findByPk(req.params.id, { 
            include: [{ model: User, as: 'Processor' }] 
        });
        if (!currentCall) return res.redirect(BASE_URL + '/');

        await ReadStatus.findOrCreate({
            where: { UserId: userId, CallId: currentCall.id }
        });

        const readCalls = await ReadStatus.findAll({
            where: { UserId: userId },
            attributes: ['CallId'],
            raw: true
        });
        const readIds = readCalls.map(r => r.CallId);

        const sidebarDates = await Call.findAll({
            attributes: [
                'date',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.literal(`(
                    SELECT COUNT(*) FROM Calls as c2 
                    WHERE c2.date = Call.date 
                    AND c2.id NOT IN (SELECT CallId FROM ReadStatuses WHERE UserId = ${userId})
                )`), 'unreadCount']
            ],
            group: ['date'],
            order: [['date', 'DESC']],
            limit: 60,
            raw: true
        });

        let dayWhere = { date: currentCall.date };
        if (status && status !== 'all' && status !== 'без статуса') {
            dayWhere.status = status;
        } else if (status === 'без статуса') {
            dayWhere.status = { [Op.or]: [null, 'без статуса', ''] };
        }
        
        if (activity === 'грубая ошибка') {
            dayWhere[Op.or] = [
                { rudeness: { [Op.gt]: 0.5 } }, 
                { said_hello: false }, 
                { politeness: { [Op.lt]: 0.5 } }, 
                { friendliness: { [Op.lt]: 0.5 } }, 
                { manipulativeness: { [Op.gt]: 0.5 } }
            ];
        } else if (activity === 'агрессия') {
            dayWhere.rudeness = { [Op.gt]: 0.5 };
        } else if (activity === 'отсутствие приветствия') {
            dayWhere.said_hello = false;
        } else if (activity === 'вежливость') {
            dayWhere.politeness = { [Op.lt]: 0.5 };
        } else if (activity === 'дружелюбие') {
            dayWhere.friendliness = { [Op.lt]: 0.5 };
        } else if (activity === 'манипуляция') {
            dayWhere.manipulativeness = { [Op.gt]: 0.5 };
        }
        
        const currentDayCalls = await Call.findAll({
            where: dayWhere,
            order: [['time', 'DESC']]
        });

        const callNotes = await Note.findAll({ 
            where: { CallId: currentCall.id }, 
            include: [User],
            order: [['createdAt', 'DESC']] 
        });

        res.render('details', { 
            currentCall, 
            sidebarDates, 
            currentDayCalls, 
            readIds,
            callNotes,
            moment, 
            currentStatusFilter: status || 'all', 
            currentActivityFilter: activity || 'все звонки',
            activeTab: tab || 'brief'
        });

    } catch (err) { 
        console.error("Route Error:", err);
        res.status(500).send(err.message); 
    }
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
        if (req.user.role !== 'superadmin') {
            where.UserId = req.user.id;
        }
        const notes = await Note.findAll({ 
            where, 
            include: [{ model: Call }, { model: User }],
            order: [['createdAt', 'DESC']]
        });
        res.render('my-notes', { notes, moment });
    } catch (err) { res.status(500).send(err.message); }
});

app.post(BASE_URL + '/api/notes', checkAuth, async (req, res) => {
    const { callId, content } = req.body;
    try {
        await Note.create({ CallId: callId, UserId: req.user.id, content });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.put(BASE_URL + '/api/notes/:id', checkAuth, async (req, res) => {
    try {
        const note = await Note.findByPk(req.params.id);
        if (!note) return res.status(404).json({ success: false });
        if (req.user.role !== 'superadmin' && note.UserId !== req.user.id) return res.status(403).json({ success: false });
        note.content = req.body.content;
        await note.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.delete(BASE_URL + '/api/notes/:id', checkAuth, async (req, res) => {
    try {
        const note = await Note.findByPk(req.params.id);
        if (!note) return res.status(404).json({ success: false });
        if (req.user.role !== 'superadmin' && note.UserId !== req.user.id) return res.status(403).json({ success: false });
        await note.destroy();
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