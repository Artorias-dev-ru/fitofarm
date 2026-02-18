const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const DB_FILE = process.env.DB_FILE || 'callcenter.sqlite';
const DB_STORAGE_DIR = path.join(__dirname, 'db_store');
if (!fs.existsSync(DB_STORAGE_DIR)) fs.mkdirSync(DB_STORAGE_DIR, { recursive: true });

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(DB_STORAGE_DIR, DB_FILE),
    logging: false,
    retry: { match: [/SQLITE_BUSY/], max: 5 }
});

const Call = sequelize.define('Call', {
    uid: { type: DataTypes.STRING, unique: true },
    date: { type: DataTypes.DATEONLY },
    time: { type: DataTypes.STRING },
    phoneNumber: { type: DataTypes.STRING },
    direction: { type: DataTypes.STRING }, 
    status: { type: DataTypes.STRING }, 
    quality: { type: DataTypes.STRING },
    duration: { type: DataTypes.FLOAT },
    text: { type: DataTypes.TEXT },
    summary: { type: DataTypes.TEXT },
    manualResult: { type: DataTypes.TEXT },
    audioUrl: { type: DataTypes.STRING }, 
    folderPath: { type: DataTypes.STRING },
    transcribedText: { type: DataTypes.TEXT },
    politeness: { type: DataTypes.FLOAT, defaultValue: 0 },
    friendliness: { type: DataTypes.FLOAT, defaultValue: 0 },
    rudeness: { type: DataTypes.FLOAT, defaultValue: 0 },
    manipulativeness: { type: DataTypes.FLOAT, defaultValue: 0 },
    said_hello: { type: DataTypes.BOOLEAN, defaultValue: false },
    processedById: { type: DataTypes.INTEGER }
});

const User = sequelize.define('User', {
    fullName: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING, unique: true },
    username: { type: DataTypes.STRING, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'admin' },
    avatar: { type: DataTypes.STRING, defaultValue: '/callcenter/public/avatar1.png' }
});

const Setting = sequelize.define('Setting', {
    key: { type: DataTypes.STRING, unique: true },
    value: { type: DataTypes.STRING }
});

const Note = sequelize.define('Note', { 
    content: { type: DataTypes.TEXT, allowNull: false } 
});

User.hasMany(Note); Note.belongsTo(User);
Call.hasMany(Note); Note.belongsTo(Call);
Call.belongsTo(User, { as: 'Processor', foreignKey: 'processedById' });

async function initDB() {
    try {
        await sequelize.sync();
        const superAdmin = await User.findOne({ where: { role: 'superadmin' } });
        if (!superAdmin) {
            await User.create({ 
                fullName: 'Главный Администратор', 
                username: 'superadmin', 
                email: 'admin@fitofarm.ru',
                password: 'admin', 
                role: 'superadmin',
                avatar: '/callcenter/public/avatar1.png'
            });
        }
        if (typeof Setting !== 'undefined') {
            await Setting.findOrCreate({ where: { key: 'threshold_low' }, defaults: { value: '20' } });
            await Setting.findOrCreate({ where: { key: 'threshold_high' }, defaults: { value: '50' } });
        }
    } catch (err) { console.error("DB Error:", err); }
}

module.exports = { Call, User, Note, Setting, Op, sequelize, initDB };