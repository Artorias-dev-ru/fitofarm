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
            startTime: "03:21", endTime: "03:56",
            text: `[201.03-202.59] SPEAKER_00: здрасьте\n[206.29-210.00] SPEAKER_00: как он там сейчас нет нету...`,
            summary: "Покупатель спрашивает о наличии, фармацевт сообщает, что товара нет и направляет в другой отдел."
        },
        {
            title: "Диалог 2",
            status: "sales",
            startTime: "14:06", endTime: "20:30",
            text: `[846.16-847.32] SPEAKER_01: вет\n[866.29-868.20] SPEAKER_00: я продавал за наличку...`,
            summary: "Успешная продажа за наличный расчет. Обсуждение погоды и текущих дел."
        },
        {
            title: "Диалог 3",
            status: "refusals",
            startTime: "20:48", endTime: "23:45",
            text: `[1248.53-1249.93] SPEAKER_00: здравствуйте\n[1270.26-1272.50] SPEAKER_00: сто одиннадцать рублей...`,
            summary: "Отказ от покупки. Несмотря на озвученную цену, продажа не состоялась."
        },
        {
            title: "Диалог 4",
            status: "unknown",
            startTime: "24:03", endTime: "31:40",
            text: `[1443.59-1443.98] SPEAKER_01: финал\n[1475.71-1477.85] SPEAKER_00: здравствуйте...`,
            summary: "Нераспознанный диалог средней четкости. Речь идет о погоде и личных делах."
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