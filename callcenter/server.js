const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');
const ftp = require("basic-ftp"); 
const cron = require('node-cron');
const { Call, User, Note, Op, initDB } = require('./db');
const { runSync, getSyncStatus } = require('./sync');

const app = express();

app.set('trust proxy', 1);

const BASE_URL = process.env.BASE_URL || '/callcenter';
const DATA_FOLDER = process.env.DATA_FOLDER || 'data';

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
    cookie: { 
        path: '/callcenter',
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
    if (req.user) return next();
    res.redirect(BASE_URL + '/login');
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
    try {
        const calls = await Call.findAll({
            order: [['date', 'DESC'], ['time', 'DESC']],
            limit: 200
        });
        
        res.render('dashboard', {
            calls: calls,
            user: req.user
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get(BASE_URL + '/details/:id', checkAuth, async (req, res) => {
    try {
        const callId = req.params.id;
        const call = await Call.findByPk(callId);
        
        if (!call) return res.redirect(BASE_URL + '/');

        const noteEntry = await Note.findOne({
            where: { CallId: call.id, UserId: req.user.id }
        });
        call.note = noteEntry ? noteEntry.content : '';

        res.render('details', {
            call: call,
            user: req.user
        });

    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get(BASE_URL + '/api/audio/:id', checkAuth, async (req, res) => {
    const callId = req.params.id;
    const client = new ftp.Client();
    client.ftp.ipFamily = 4;

    try {
        const call = await Call.findByPk(callId);
        if (!call || !call.audioUrl) return res.status(404).send('Not found');

        const remoteFilePath = call.audioUrl; 

        await client.access({
            host: process.env.FTP_HOST,
            port: parseInt(process.env.FTP_PORT),
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });

        try {
            const size = await client.size(remoteFilePath);
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Content-Length', size);
            res.setHeader('Accept-Ranges', 'bytes');
            await client.downloadTo(res, remoteFilePath);
        } catch(ftpErr) {
            console.error(ftpErr);
            return res.status(404).send("File error");
        }

    } catch (err) {
        if (!res.headersSent) res.status(500).send('Stream error');
    } finally {
        client.close();
    }
});

app.post(BASE_URL + '/api/save-note', checkAuth, async (req, res) => {
    try {
        const { callId, note } = req.body;
        const userId = req.user.id;
        const existingNote = await Note.findOne({ where: { CallId: callId, UserId: userId } });

        if (existingNote) {
            existingNote.content = note;
            await existingNote.save();
        } else {
            await Note.create({ content: note, CallId: callId, UserId: userId });
        }
        res.json({ success: true });
    } catch (err) {
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
        let targetDb;
        let tableName;

        if (base === 'callcenter') {
            const { Call } = require('./callcenter_db_path');
            targetDb = Call;
            tableName = 'Calls';
        } else if (base === 'fitofarm') {
            const { Dialog } = require('./db');
            targetDb = Dialog;
            tableName = 'Dialogs';
        } else {
            return res.status(404).send('db_not_found');
        }

        const deletedCount = await targetDb.destroy({
            where: { date: formattedDate }
        });

        await targetDb.destroy({
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

initDB()
    .then(() => {
        cron.schedule('0 9 * * *', () => {
            console.log('Running scheduled sync');
            runSync().catch(e => console.error(e));
        });

        runSync().then(() => console.log('Initial sync done')).catch(e => console.error(e));
        
        app.listen(3000, '0.0.0.0', () => console.log('Callcenter Server started'));
    })
    .catch(err => console.error(err));