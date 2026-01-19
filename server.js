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
app.use(bodyParser.json()); // Для работы API сохранения заметок

app.use(session({
    secret: 'fitopharm_secret_key',
    resave: false,
    saveUninitialized: true
}));

function checkAuth(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Вспомогательная функция для фильтрации по дате
function getDateWhere(period, startDate, endDate) {
    const today = moment().format('YYYY-MM-DD');
    
    // Если выбраны конкретные даты в календаре
    if (startDate && endDate) {
        return { [Op.between]: [startDate, endDate] };
    }
    
    // Логика периодов для выпадающего списка
    if (period === 'today') return today;
    if (period === 'yesterday') return moment().subtract(1, 'days').format('YYYY-MM-DD');
    if (period === '2days') return { [Op.gte]: moment().subtract(1, 'days').format('YYYY-MM-DD') }; // Сегодня + Вчера
    if (period === 'week') return { [Op.gte]: moment().subtract(7, 'days').format('YYYY-MM-DD') };
    if (period === 'month') return { [Op.gte]: moment().subtract(1, 'months').format('YYYY-MM-DD') };
    if (period === '6months') return { [Op.gte]: moment().subtract(6, 'months').format('YYYY-MM-DD') };
    if (period === 'year') return { [Op.gte]: moment().subtract(1, 'years').format('YYYY-MM-DD') };
    
    // Если ничего не выбрано - показываем всё
    return { [Op.not]: null }; 
}

// --- API: Сохранение заметки ---
app.post('/api/save-note', checkAuth, async (req, res) => {
    try {
        const { dialogId, note } = req.body;
        // Обновляем поле note в базе
        await Dialog.update({ note: note }, { where: { id: dialogId } });
        res.json({ success: true });
    } catch (err) {
        console.error("Ошибка сохранения заметки:", err);
        res.status(500).json({ success: false });
    }
});

// --- ГЛАВНАЯ СТРАНИЦА (DASHBOARD) ---
app.get('/', checkAuth, async (req, res) => {
    const { period, sortType, startDate, endDate } = req.query;
    
    // По умолчанию ставим "Год", если не выбран другой период
    const activePeriod = period || (startDate ? '' : 'year');
    
    const dateWhere = getDateWhere(activePeriod, startDate, endDate);

    try {
        // Загружаем аптеки и подключаем только те диалоги, которые подходят под дату
        const recordsRaw = await Record.findAll({ 
            include: [{
                model: Dialog,
                where: { date: dateWhere },
                required: true // Показываем аптеку, только если у неё есть диалоги за этот период
            }]
        });

        const viewData = recordsRaw.map(rec => {
            const plainRec = rec.get({ plain: true });
            if (!plainRec.Dialogs) plainRec.Dialogs = [];

            // Считаем статистику "на лету" по отфильтрованным диалогам
            plainRec.sales = plainRec.Dialogs.filter(d => d.status === 'sales').length;
            plainRec.refusals = plainRec.Dialogs.filter(d => d.status === 'refusals').length;
            plainRec.unknown = plainRec.Dialogs.filter(d => d.status === 'unknown').length;
            return plainRec;
        });

        // ЛОГИКА СОРТИРОВКИ
        if (sortType === 'sales') {
            viewData.sort((a, b) => b.sales - a.sales);
        } else if (sortType === 'refusals') {
            viewData.sort((a, b) => b.refusals - a.refusals);
        } else if (sortType === 'unknown') {
            viewData.sort((a, b) => b.unknown - a.unknown);
        } else {
            // По умолчанию: По алфавиту
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
        res.status(500).send("Ошибка сервера: " + err.message);
    }
});

// --- СТРАНИЦА ДЕТАЛЕЙ АПТЕКИ ---
app.get('/details/:id', checkAuth, async (req, res) => {
    try {
        // Получаем tab из параметров, чтобы знать, какая вкладка активна (summary/notes)
        const { startDate, endDate, type, dialogId, period, tab } = req.query;
        const recordId = req.params.id;
        
        const activePeriod = period || (startDate ? '' : 'year');
        const dateWhere = getDateWhere(activePeriod, startDate, endDate);

        const itemRaw = await Record.findByPk(recordId);
        if (!itemRaw) return res.redirect('/');
        
        // Получаем все диалоги этой аптеки за дату (для верхней статистики)
        const allDialogs = await Dialog.findAll({ 
            where: { RecordId: recordId, date: dateWhere } 
        });

        const item = itemRaw.get({ plain: true });
        item.sales = allDialogs.filter(d => d.status === 'sales').length;
        item.refusals = allDialogs.filter(d => d.status === 'refusals').length;
        item.unknown = allDialogs.filter(d => d.status === 'unknown').length;

        // Фильтр для списка диалогов слева (по статусу + по дате)
        let listWhere = { RecordId: recordId, date: dateWhere };
        if (type) {
            listWhere.status = type;
        }

        const dialogues = await Dialog.findAll({
            where: listWhere,
            order: [['id', 'ASC']] // Сортируем по порядку добавления (можно и по number)
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
            activeTab: tab || 'summary' // Передаем активную вкладку
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Ошибка при загрузке деталей");
    }
});

// --- ВХОД В СИСТЕМУ ---
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

// --- ЗАПУСК СЕРВЕРА (после загрузки БД) ---
console.log("Ждем загрузки данных...");
initDB().then(() => {
    app.listen(3000, () => {
        console.log('Server started on port 3000 (Data fully loaded)');
    });
}).catch(err => {
    console.error("Ошибка инициализации БД:", err);
});