const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.DB_FILE || 'database.sqlite';
const DATA_FOLDER = process.env.DATA_FOLDER || 'data';
const BASE_URL = process.env.BASE_URL || '';
const DB_STORAGE_DIR = path.join(__dirname, 'db_store');

if (!fs.existsSync(DB_STORAGE_DIR)) {
    fs.mkdirSync(DB_STORAGE_DIR, { recursive: true });
}

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(DB_STORAGE_DIR, DB_FILE),
    logging: false,
    retry: {
        match: [/SQLITE_BUSY/],
        max: 5
    }
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

Record.hasMany(Dialog);
Dialog.belongsTo(Record);

async function initDB() {
    try {
        const start = Date.now();
        await sequelize.sync();
        
        const dataDir = path.join(__dirname, DATA_FOLDER);
        if (!fs.existsSync(dataDir)) return;

        const allExistingDialogs = await Dialog.findAll({
            attributes: ['folderPath']
        });
        const existingPaths = new Set(allExistingDialogs.map(d => d.folderPath).filter(Boolean));

        if (DATA_FOLDER.includes('callcenter')) {
            const outputDir = path.join(dataDir, 'output');
            const ishodDir = path.join(dataDir, 'ishod');
            const mp3OutputDir = path.join(dataDir, 'output-mp3');

            if (!fs.existsSync(outputDir)) return;

            const [record] = await Record.findOrCreate({
                where: { address: "Основная линия" },
                defaults: { city: "Колл-центр" }
            });

            const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.txt'));

            const sortedFiles = files.map(file => {
                try {
                    const parts = file.split('-');
                    if (parts.length < 5) return null;
                    const sortKey = parseInt(parts[3] + parts[4]); 
                    return { file, sortKey };
                } catch (e) {
                    return null;
                }
            })
            .filter(item => item !== null)
            .sort((a, b) => a.sortKey - b.sortKey);

            let dialogsBatch = [];
            let dialogCounter = existingPaths.size + 1;

            for (const fileObj of sortedFiles) {
                const txtFile = fileObj.file;
                const uniquePathKey = txtFile;

                if (existingPaths.has(uniquePathKey)) continue;

                try {
                    const parts = txtFile.split('-');
                    const phone = parts[2];
                    const dateRaw = parts[3]; 
                    const timeRaw = parts[4]; 

                    const dbDate = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
                    const startTime = `${timeRaw.substring(0, 2)}:${timeRaw.substring(2, 4)}`;

                    const txtPath = path.join(outputDir, txtFile);
                    const txtContent = fs.readFileSync(txtPath, 'utf-8');

                    const audioName = txtFile.replace('.txt', '.mp3');
                    const audioFullPath = path.join(ishodDir, audioName);
                    let audioWebPath = null;

                    if (fs.existsSync(audioFullPath)) {
                        audioWebPath = `/data/ishod/${audioName}`;
                    }

                    let transcribedText = "";
                    let summaryText = `Тел: ${phone}`;

                    const folderName = txtFile.replace('.txt', '');
                    const specificMp3OutputDir = path.join(mp3OutputDir, folderName);

                    if (fs.existsSync(specificMp3OutputDir) && fs.lstatSync(specificMp3OutputDir).isDirectory()) {
                        const subfolders = fs.readdirSync(specificMp3OutputDir);
                        if (subfolders.length > 0) {
                            const innerPath = path.join(specificMp3OutputDir, subfolders[0]);
                            const compareTxtPath = path.join(innerPath, 'dialog.txt');
                            if (fs.existsSync(compareTxtPath)) {
                                transcribedText = fs.readFileSync(compareTxtPath, 'utf-8');
                            }
                            const metadataPath = path.join(innerPath, 'metadata.json');
                            if (fs.existsSync(metadataPath)) {
                                try {
                                    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                                    if (meta.metrics && meta.metrics.summary) {
                                        summaryText += `\n\nСводка:\n${meta.metrics.summary}`;
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    dialogsBatch.push({
                        title: `call ${dialogCounter}`,
                        number: dialogCounter,
                        status: 'unknown',
                        text: txtContent,
                        transcribedText: transcribedText,
                        summary: summaryText,
                        startTime: startTime,
                        date: dbDate,
                        RecordId: record.id,
                        note: "",
                        audioUrl: audioWebPath,
                        folderPath: uniquePathKey
                    });

                    dialogCounter++;
                } catch (err) {}
            }

            if (dialogsBatch.length > 0) {
                await Dialog.bulkCreate(dialogsBatch, { ignoreDuplicates: true });
            }
        } else {
            const pharmacyFolders = fs.readdirSync(dataDir);
            for (const phId of pharmacyFolders) {
                const phPath = path.join(dataDir, phId);
                if (!fs.lstatSync(phPath).isDirectory()) continue;

                const [record] = await Record.findOrCreate({
                    where: { address: phId === "1" ? "Владимирская 114" : `аптека № ${phId}` },
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

                        const outFiles = fs.readdirSync(outPath);
                        const dialogFolders = outFiles.filter(f => fs.lstatSync(path.join(outPath, f)).isDirectory());

                        for (const dFolder of dialogFolders) {
                            const dPath = path.join(outPath, dFolder);
                            const uniquePathKey = path.relative(dataDir, dPath).split(path.sep).join('/');

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
                                audioWebPath = `/data/${phId}/${groupFolder}/${outFolder}/${dFolder}/${audioFile}`;
                            }

                            if (txtFile && jsonFile) {
                                try {
                                    const rawTxtContent = fs.readFileSync(path.join(dPath, txtFile), 'utf-8');
                                    const txtContent = rawTxtContent.split('\n').filter(line => {
                                        const trimmed = line.trim();
                                        return !(/^\[.*?\] SPEAKER_\d+:\s*$/.test(trimmed)) && trimmed.length > 0;
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

                                    let summaryText = jsonData.metrics?.summary || jsonData.summary || "";

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
                                } catch (err) {}
                            }
                        }
                    }
                }
                if (dialogsBatch.length > 0) {
                    await Dialog.bulkCreate(dialogsBatch, { ignoreDuplicates: true });
                }
            }
        }
    } catch (globalErr) {}
}

module.exports = { Record, Dialog, Op, initDB };