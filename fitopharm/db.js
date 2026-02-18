const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.DB_FILE || 'database.sqlite';
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

const Record = sequelize.define('Record', {
    city: { type: DataTypes.STRING, defaultValue: "Анапа" },
    address: { type: DataTypes.STRING, allowNull: false }
});

const Dialog = sequelize.define('Dialog', {
    title: DataTypes.STRING,
    status: DataTypes.STRING,
    text: DataTypes.TEXT,
    summary: DataTypes.TEXT,
    startTime: DataTypes.STRING,
    date: { type: DataTypes.DATEONLY, allowNull: false },
    endTime: DataTypes.STRING,
    number: { type: DataTypes.INTEGER, allowNull: false },
    note: { type: DataTypes.TEXT },
    audioUrl: { type: DataTypes.STRING },
    folderPath: { type: DataTypes.STRING, unique: true },
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


Record.hasMany(Dialog);
Dialog.belongsTo(Record);

User.hasMany(Note);
Note.belongsTo(User);

Dialog.hasMany(Note);
Note.belongsTo(Dialog);

async function initDB() {
    try {
        await sequelize.sync();
        
        
        const adminExists = await User.findOne({ where: { username: 'admin' } });
        if (!adminExists) {
            await User.create({
                fullName: 'Администратор',
                username: 'admin',
                password: 'admin', 
                role: 'superadmin'
            });
        }
    } catch (globalErr) {
        console.error("DB Init Error:", globalErr);
    }
}


module.exports = { Record, Dialog, User, Note, Op, initDB };