const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database.sqlite'),
    logging: false
});

const Record = sequelize.define('Record', {
    city: { type: DataTypes.STRING, defaultValue: "Анапа" },
    address: { type: DataTypes.STRING, allowNull: false },
    sales: { type: DataTypes.INTEGER, defaultValue: 0 },
    refusals: { type: DataTypes.INTEGER, defaultValue: 0 },
    unknown: { type: DataTypes.INTEGER, defaultValue: 0 },
    date: { type: DataTypes.DATEONLY, allowNull: false }
});

const Dialog = sequelize.define('Dialog', {
    title: DataTypes.STRING,
    status: DataTypes.STRING,
    text: DataTypes.TEXT,
    summary: DataTypes.TEXT,
    startTime: DataTypes.STRING,
    endTime: DataTypes.STRING
});

Record.hasMany(Dialog);
Dialog.belongsTo(Record);

async function initDB() {
    await sequelize.sync({ force: true });

    const pharmacies = await Record.bulkCreate([
        { city: "Анапа", address: "Владимирская 155", sales: 40, refusals: 78, unknown: 9, date: '2026-01-15' },
        { city: "Анапа", address: "Тургенева 255", sales: 20, refusals: 30, unknown: 5, date: '2026-01-14' },
        { city: "Анапа", address: "Гоголя 983", sales: 10, refusals: 10, unknown: 1, date: '2026-01-08' }
    ]);

    const dialogsData = [
        {
            title: "Диалог 1",
            status: "refusals",
            startTime: "03:21",
            endTime: "03:56",
            text: `[201.03-202.59] SPEAKER_00: здрасьте
[206.29-210.00] SPEAKER_00: как он там сейчас нет нету
[210.30-215.00] SPEAKER_00: пройдите вот по вот этой ж дальше техника есть
[217.18-220.00] SPEAKER_00: ну в этом же здании только электронном только электронно
[220.17-225.00] SPEAKER_00: еще до праздников все разобрали градус
[225.20-230.00] SPEAKER_00: да вот вот через четыре магазинчика вот в эту сторону вам даже не туда это
[230.00-232.27] SPEAKER_00: зайдите к ним может они
[232.38-235.00] SPEAKER_00: до праздников у них были
[235.20-236.47] SPEAKER_00: спасибо`,
            summary: "Участники обсуждают отсутствие товара. Покупатель спрашивает о наличии, фармацевт сообщает, что товара нет в наличии и предлагает зайти позже или в другой отдел."
        },
        {
            title: "Диалог 2",
            status: "sales",
            startTime: "14:06",
            endTime: "20:30",
            text: `[846.16-847.32] SPEAKER_01: вет
[850.00-855.00] SPEAKER_00: тепло ветер такой ледяной как дела
[855.00-860.00] SPEAKER_00: чуть ли не посреди дороги кидают
[866.29-868.20] SPEAKER_00: я продавал за наличку
[870.17-875.00] SPEAKER_00: пятнадцать флаконов числится если попробовал
[890.88-895.00] SPEAKER_00: походу этот в альфу тоже не привезли
[895.00-897.47] SPEAKER_01: у вас есть
[897.47-898.58] SPEAKER_00: тринадус
[907.92-910.00] SPEAKER_00: спрей нужен да
[1120.07-1125.00] SPEAKER_00: таблетки для женск клима смотрите для женск клима
[1140.17-1144.19] SPEAKER_00: крыма отдельно для женского да я вижу
[1155.00-1160.00] SPEAKER_00: а вы сами по себе или тоже они где в ваших`,
            summary: "Успешная продажа за наличный расчет. Обсуждение погоды и текущих дел в аптеке переходит в оформление покупки препаратов."
        },
        {
            title: "Диалог 3",
            status: "refusals",
            startTime: "20:48",
            endTime: "23:45",
            text: `[1248.53-1249.93] SPEAKER_00: здравствуйте
[1250.52-1252.08] SPEAKER_00: такое че нибудь
[1270.26-1272.50] SPEAKER_00: сто одиннадцать рублей
[1291.51-1294.83] SPEAKER_00: хорошего дня
[1300.62-1303.90] SPEAKER_00: последнюю пачку
[1305.00-1306.45] SPEAKER_01: а давление
[1315.74-1320.00] SPEAKER_00: раствором он мелочи взяла
[1320.14-1325.00] SPEAKER_00: вот это что наука надо что это
[1352.38-1355.00] SPEAKER_00: давай`,
            summary: "Отказ от покупки. Несмотря на озвученную цену в 111 рублей, продажа не состоялась. Обсуждение последней пачки и давления."
        },
        {
            title: "Диалог 4",
            status: "unknown",
            startTime: "24:03",
            endTime: "31:40",
            text: `[1443.59-1443.98] SPEAKER_01: финал
[1445.00-1450.00] SPEAKER_00: ну хотя у меня хорошая квартира но вчера прям прохладно дома было а я еще
[1450.10-1454.32] SPEAKER_00: балкон открыт в моей комнате
[1455.33-1457.18] SPEAKER_00: мама закрой окно
[1475.71-1477.85] SPEAKER_00: здравствуйте
[1480.00-1481.82] SPEAKER_00: антибиотик
[1835.00-1840.00] SPEAKER_00: ну как по работе она сейчас со мной отработает два дня да по моему и все
[1845.33-1847.67] SPEAKER_01: о природе о погоде короче все`,
            summary: "Нераспознанный диалог средней четкости. Речь идет о погоде, домашних условиях и общих темах, не связанных напрямую с покупкой лекарств."
        }
    ];

    for (const pharmacy of pharmacies) {
        for (const d of dialogsData) {
            await Dialog.create({
                ...d,
                RecordId: pharmacy.id
            });
        }
    }
}

module.exports = { Record, Dialog, Op, initDB };