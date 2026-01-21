const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.DB_FILE || 'database.sqlite';
const DATA_FOLDER = process.env.DATA_FOLDER || 'data';
const BASE_URL = process.env.BASE_URL || '';

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, DB_FILE),
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
    note: { type: DataTypes.TEXT },
    audioUrl: { type: DataTypes.STRING },
    folderPath: { type: DataTypes.STRING, unique: true } 
});

Record.hasMany(Dialog);
Dialog.belongsTo(Record);

async function initDB() {
    console.log("Checking database...");
    const start = Date.now();

    await sequelize.sync({ alter: true });
    
    console.log("Database synced. Starting incremental load...");

    const dataDir = path.join(__dirname, DATA_FOLDER);
    if (!fs.existsSync(dataDir)) {
        console.log("Data folder not found");
        return;
    }

    const allExistingDialogs = await Dialog.findAll({
        attributes: ['folderPath']
    });
    const existingPaths = new Set(allExistingDialogs.map(d => d.folderPath).filter(Boolean));
    console.log(`Found ${existingPaths.size} existing dialogs in DB. Checking for new ones...`);

    const pharmacyFolders = fs.readdirSync(dataDir);
    
    for (const phId of pharmacyFolders) {
        const phPath = path.join(dataDir, phId);
        if (!fs.lstatSync(phPath).isDirectory()) continue;

        const [record] = await Record.findOrCreate({
            where: { address: phId === "1" ? "Владимирская 114" : `аптека № ${phId}` },
            defaults: { city: "Анапа" }
        });

        let dialogCounter = 1;
        let newDialogsCount = 0;
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

                const outFiles = fs.readdirSync(outPath);
                const dialogFolders = outFiles.filter(f => fs.lstatSync(path.join(outPath, f)).isDirectory());

                for (const dFolder of dialogFolders) {
                    const dPath = path.join(outPath, dFolder);

                    const uniquePathKey = path.relative(dataDir, dPath);

                    if (existingPaths.has(uniquePathKey)) {
                        dialogCounter++; 
                        continue; 
                    }

                    const files = fs.readdirSync(dPath);
                    const txtFile = files.find(f => f.toLowerCase().endsWith('.txt'));
                    const jsonFile = files.find(f => f.toLowerCase().endsWith('.json'));

                    const audioFile = files.find(f => ['.mp3', '.wav', '.ogg', '.m4a'].some(ext => f.toLowerCase().endsWith(ext)));
                    let audioWebPath = null;

                    if (audioFile) {
                        audioWebPath = `${BASE_URL}/data/${phId}/${groupFolder}/${outFolder}/${dFolder}/${audioFile}`;
                    }
                    if (txtFile && jsonFile) {
                        try {
                            const rawTxtContent = fs.readFileSync(path.join(dPath, txtFile), 'utf-8');
                            const txtContent = rawTxtContent.split('\n').filter(line => {
                                const trimmed = line.trim();
                                const emptyPhraseRegex = /^\[.*?\] SPEAKER_\d+:\s*$/;
                                return !emptyPhraseRegex.test(trimmed) && trimmed.length > 0;
                            }).join('\n');

                            const jsonData = JSON.parse(fs.readFileSync(path.join(dPath, jsonFile), 'utf-8'));

                            const dParts = dFolder.split('_');
                            let finalTime = `${baseHour}:00`;
                            if (dParts.length > 1 && dParts[1].length >= 4) {
                                finalTime = `${baseHour}:${dParts[1].substring(2, 4)}`;
                            }

                            let status = 'refusals';
                            if (dFolder.toLowerCase().includes('bad')) status = 'unknown';
                            else if (jsonData.metrics && jsonData.metrics.sale_occurred === true) status = 'sales';

                            let summaryText = "";
                            if (jsonData.metrics && jsonData.metrics.summary) {
                                summaryText = jsonData.metrics.summary;
                            } else if (jsonData.summary) {
                                summaryText = jsonData.summary;
                            }

                            dialogsBatch.push({
                                title: `dialog ${dialogCounter}`,
                                number: dialogCounter,
                                status: status,
                                text: txtContent,
                                summary: summaryText,
                                startTime: finalTime,
                                date: dbDate,
                                RecordId: record.id,
                                note: "",
                                audioUrl: audioWebPath,
                                folderPath: uniquePathKey
                            });
                            
                            dialogCounter++;
                            newDialogsCount++;

                        } catch (err) {
                            console.log(`Error parsing new dialog ${dFolder}: ${err.message}`);
                        }
                    }
                }
            }
        }

        if (dialogsBatch.length > 0) {
            await Dialog.bulkCreate(dialogsBatch, { ignoreDuplicates: true });
            console.log(`Added ${newDialogsCount} NEW dialogs for ${record.address}`);
        }
    }
    console.log(`Incremental load completed took ${(Date.now() - start) / 1000} seconds`);
}

module.exports = { Record, Dialog, Op, initDB };