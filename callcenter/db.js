const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.DB_FILE || 'callcenter.sqlite';
const DB_STORAGE_DIR = path.join(__dirname, 'db_store');

if (!fs.existsSync(DB_STORAGE_DIR)) {
    fs.mkdirSync(DB_STORAGE_DIR, { recursive: true });
}

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
    audioUrl: { type: DataTypes.STRING }, 
    folderPath: { type: DataTypes.STRING },
    transcribedText: { type: DataTypes.TEXT }
});

const User = sequelize.define('User', {
    fullName: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING, unique: true },
    username: { type: DataTypes.STRING, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'user' }
});

const Note = sequelize.define('Note', {
    content: { type: DataTypes.TEXT, allowNull: false }
});

User.hasMany(Note);
Note.belongsTo(User);

Call.hasMany(Note);
Note.belongsTo(Call);

async function initDB() {
    try {
        await sequelize.sync();
        
        const adminExists = await User.findOne({ where: { username: 'admin' } });
        if (!adminExists) {
            await User.create({
                fullName: 'Администратор КЦ',
                username: 'admin',
                password: 'admin', 
                role: 'superadmin'
            });
        }
    } catch (globalErr) {
        console.error("DB Init Error:", globalErr);
    }
}

module.exports = { Call, User, Note, Op, initDB };