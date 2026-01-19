const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database.sqlite'),
    logging: false
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
    note: { type: DataTypes.TEXT }
});

Record.hasMany(Dialog);
Dialog.belongsTo(Record);

async function initDB() {
    console.log("checking database");
    const start = Date.now();
    await sequelize.sync({ alter: true });
    const count = await Dialog.count();
    if (count > 0) {
        console.log(`database already contains ${count} dialogs parsing skipped data preserved`);
        return;
    }
    console.log("database is empty starting initial load from files");
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        console.log("data folder not found");
        return;
    }
    const pharmacyFolders = fs.readdirSync(dataDir); 
    for (const phId of pharmacyFolders) {
        const phPath = path.join(dataDir, phId);
        if (!fs.lstatSync(phPath).isDirectory()) continue;
        const [record] = await Record.findOrCreate({
            where: { address: phId === "1" ? "тестовая аптека" : `аптека № ${phId}` },
            defaults: { city: "Анапа" }
        });
        let dialogCounter = 1;
        let dialogsBatch = [];
        const groupFolders = fs.readdirSync(phPath).sort(); 
        for (const groupFolder of groupFolders) {
            const groupPath = path.join(phPath, groupFolder);
            if (!fs.lstatSync(groupPath).isDirectory()) continue;
            const outFolders = fs.readdirSync(groupPath);
            for (const outFolder of outFolders) {
                const outPath = path.join(groupPath, outFolder);
                if (!fs.lstatSync(outPath).isDirectory()) continue;
                const folderParts = outFolder.split('_');
                if (folderParts.length < 3) continue;
                const dateRaw = folderParts[1]; 
                const timeRaw = folderParts[2]; 
                const [dd, mm, yyyy] = dateRaw.split('-');
                const dbDate = `${yyyy}-${mm}-${dd}`;
                const baseHour = timeRaw.split('-')[0];
                const dialogFolders = fs.readdirSync(outPath);
                for (const dFolder of dialogFolders) {
                    const dPath = path.join(outPath, dFolder);
                    if (!fs.lstatSync(dPath).isDirectory()) continue;
                    const files = fs.readdirSync(dPath);
                    const txtFile = files.find(f => f.toLowerCase().endsWith('.txt'));
                    const jsonFile = files.find(f => f.toLowerCase().endsWith('.json'));
                    if (txtFile && jsonFile) {
                        const txtContent = fs.readFileSync(path.join(dPath, txtFile), 'utf-8');
                        const jsonData = JSON.parse(fs.readFileSync(path.join(dPath, jsonFile), 'utf-8'));
                        const dParts = dFolder.split('_');
                        let finalTime = `${baseHour}:00`; 
                        if (dParts.length > 1) {
                            finalTime = `${baseHour}:${dParts[1].substring(2, 4)}`;
                        }
                        let status = 'refusals'; 
                        if (dFolder.toLowerCase().includes('_bad_')) status = 'unknown'; 
                        else if (jsonData.metrics && jsonData.metrics.sale_occurred === true) status = 'sales'; 
                        dialogsBatch.push({
                            title: `dialog ${dialogCounter}`, 
                            number: dialogCounter,
                            status: status,
                            text: txtContent,
                            summary: `Качество ${jsonData.quality} Фраз ${jsonData.num_turns}`,
                            startTime: finalTime,
                            date: dbDate,
                            RecordId: record.id,
                            note: ""
                        });
                        dialogCounter++;
                    }
                }
            }
        }
        if (dialogsBatch.length > 0) {
            await Dialog.bulkCreate(dialogsBatch);
            console.log(`loaded ${dialogsBatch.length} dialogs for ${record.address}`);
        }
    }
    console.log(`initial load completed took ${(Date.now() - start) / 1000} seconds`);
}

module.exports = { Record, Dialog, Op, initDB };