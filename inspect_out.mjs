import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load('D:/data_orbita/temp/2026年6-9月支出总表_含9月.xlsx')); const z=await wb.inspect({kind:'sheet,table',maxChars:5000,tableMaxRows:2,tableMaxCols:3}); console.log(z.ndjson);
