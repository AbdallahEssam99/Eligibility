import axios from 'axios';
import path, { dirname } from 'path';
import xlsx from 'xlsx';



function excelDateToJSDate(excelDate:number) {
    const excelEpoch = 25569; // Excel's epoch date (January 1, 1900)
    const millisecondsPerDay = 86400000; // Number of milliseconds in a day
    const jsDate = new Date((excelDate - excelEpoch) * millisecondsPerDay);

    // Format the date as 'MM-DD-YYYY'
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const day = jsDate.getDate().toString().padStart(2, '0');
    const year = jsDate.getFullYear();

    return `${month}-${day}-${year}`;
}

interface PayerData {
    'Payer Name': string;
    'Payer ID': string;
    'Payer Short Name': string;
    'Transaction Type (ID)': string;
    Portal: string;
    Batch: string;
    'Real Time (SOAP)': string;
    'REST (API)': string;
    'Enrollment Required': string;
    // Add other properties as needed
}
import stringSimilarity from 'string-similarity';

const getPayerId = (payerName:string) => {
    const capitalizedName = payerName.toUpperCase();
    const filePath = path.join(__dirname, '../Availity_Payer_List_Export_16.xltx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data: PayerData[] = xlsx.utils.sheet_to_json<PayerData>(sheet);

    // Filter rows based on specific criteria
    const eligiblePayers = data.filter((row:any) =>
        row['Transaction Type (ID)'] === 'Eligibility and Benefits Inquiry (270)' &&
        row['Portal'] === 'Available'
    );

    // Attempt to find an exact match
    let payer = eligiblePayers.find((row:any) =>row['Payer Name'] === capitalizedName);
    // If no exact match is found, find the most similar payer name
    if (!payer) {
        console.log('No payer found');
        const payerNames = eligiblePayers.map((row:any) => row['Payer Name']);
        const { bestMatch } = stringSimilarity.findBestMatch(payerName, payerNames);
        const bestMatchName = bestMatch.target;
        console.log(`Using similar payer name: ${bestMatchName}`);
        payer = eligiblePayers.find((row:any) => row['Payer Name'] === bestMatchName);
    }
    if (payer) {
        console.log('Payer ID:', payer['Payer ID']);
        return payer['Payer ID'];
    } else {
        console.log('No matching payer found.');
        return null;
    }
    // Return the Payer ID if a match is found
    // return payer;
};

// console.log(getPayerId('MOLINA HEALTHCARE CALIFORN'));

const filePath = path.join(__dirname, '../appointments.xlsx');

const parsePatients = (filePath: string) => {
    let rawData:any[] = [];
    
    const appointments = xlsx.readFile(filePath);
    const sheet = appointments.SheetNames[0];
    const rows = appointments.Sheets[sheet];
    
    rawData = xlsx.utils.sheet_to_json(rows);
    
    const fieldsToInclude = ['Patient Name', 'DOB (mm/dd/yyyy)', 'Patient ID', 'eligibility check', 'Member ID'];
    
    const patientData = rawData.map((row) => {
        const filteredRow:any = {};
        let eligibilityCheck = '';
        let PayerID = '';
        fieldsToInclude.forEach((field) => {
            if (row[field] !== undefined) {
                if (field === 'DOB (mm/dd/yyyy)') {
                    // Convert Excel serial date to JavaScript Date
                    filteredRow.patientBirthDate = excelDateToJSDate(row[field]);
                } else if (field === 'Patient Name') {
                    const [lastName, firstName] = row[field].split(',').map((name: string) => name.trim());
                    filteredRow.patientFirstName = firstName;
                    filteredRow.patientLastName = lastName;
                }
                else if (field === 'Patient ID') {
                    filteredRow.patientID = row[field];
                }
                else if (field === 'Member ID') {
                    filteredRow.memberId = row[field];
                }
                else {
                    filteredRow[field] = String(row[field]).replace(/[\r\n]+/g, ' ').replace(/1-/g, '').trim();
                }
                if (field === 'eligibility check') {
                    eligibilityCheck = filteredRow[field];
                    // PayerID = getPayerId(eligibilityCheck + 'CA');
                    // console.log('Insurance Name = ', eligibilityCheck, ',===>    Payer ID = ', PayerID);
                }
            }
        });
        filteredRow.PayerID = PayerID;
        return filteredRow;
    });
    
    console.log('Filtered Patient Data:', patientData[0]);
}



const authenticate = async (): Promise<any>  => {
    try{
        const res = await axios({
            url: 'https://api.availity.com/availity/v1/token',
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            // TODO add this to .env
            data: {
                grant_type: 'client_credentials',
                client_id: 'd5099088fd0df690170c266e44a9a472',
                client_secret: '02206aa98362348a2c67662c5d552d29',
                scope: 'hipaa'
            },
        })
        const token = res?.data?.access_token;
        return token;

    } catch(err){
        console.error(err);
        //throw new Error('Failed to authenticate with Availity API');
    }    
};

const getPayerConfigs = async (payerId: string): Promise<any>  => {
    try{
        const token = await authenticate();
        const type = '270';
        const res = await axios({
            url: `https://api.availity.com/availity/v1/configurations?payerId=${payerId}&type=${type}`,
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        })
 
        const configs = res?.data?.configurations;

        // const payerName: string = configs[0].payerName;
        const PayerReqFields: string[] = configs.flatMap((config: any) => Object.keys(config.elements).filter( (key) => config.elements[key].required === true ) );

        const patientDemoFields = configs[0].requiredFieldCombinations.patient;

        let unions = [];
        for(let field in patientDemoFields){
            let optionalArr = patientDemoFields[field];
            let union = [...new Set([...PayerReqFields, ...optionalArr])];
            unions.push(union);
            //console.log('unions', union);
        }
        // console.log(patientDemoFields);

        console.log('unions', unions);
        return unions;

    } catch(err){
        console.error(err);
        //throw new Error('Failed to get payer configurations');
    }    
};

const getPayerNames = async (payerId: string): Promise<any>  => {
    try{
        const token = await authenticate();
        const res = await axios({
            url: `https://api.availity.com/availity/development-partner/v1/availity-payer-list?payerId=${payerId}`,
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        })
        const payerDisplayNames = res?.data?.payers.map((payer: any) => payer.name);
        const payerShortNames = Array.from(new Set(res.data.payers.map((payer: any) => payer.shortName)));
        return {payerDisplayNames, payerShortNames};

    } catch(err){
        console.error(err);
        //throw new Error('Failed to get payer names');
    }
};

// let patientInfo = {
//     "patientID": "25213",
//     "PayerID": "HEALTHNET",//HEALTHNET
//     "patientFirstName": "Timothy",
//     "patientLastName": "Veall",
//     "patientBirthDate": "04-15-1944",
//     "patientState": "CA",
//     "providerNpi": "1760626477",
//     "memberId": "R0237753300"
// }

let patientInfo = {
    "patientID": "25213",
    "PayerID": "38333",//MOLINA
    "patientFirstName": "Remigia",
    "patientLastName": "Rodriguez",
    "patientBirthDate": "01-01-1952",
    "patientState": "CA",
    "providerNpi": "1760626477",
    "memberId": "100001294475"
}

const parseReqFields = (reqFields: string[][], patientInfo: any) => {
    try {
        // Create a new object with the necessary fields
        let newObj = { ...patientInfo }; 
        newObj['asOfDate'] = new Date().toISOString().split('T')[0]; 
        newObj['serviceType'] = 30;
        newObj['providerNpi'] = '1760626477'; 


        console.log('newObj:', newObj); // Check the contents of newObj

        let matchingFieldsObject: any = {}; // To store the result of the first match

        // Loop over each array in reqFields
        reqFields.forEach(unionArray => {
            let matchedFields: any = {}; // Object to hold matched fields for this array
            let allFieldsMatch = true; // Flag to check if all fields match

            // Loop over each field in the current array
            unionArray.forEach(field => {
                // Check if the field exists in newObj
                if (newObj.hasOwnProperty(field)) {
                    matchedFields[field] = newObj[field]; // Add the field and its value to matchedFields
                } else {
                    allFieldsMatch = false; // If any field doesn't match, set flag to false
                }
            });

            // If all fields match, push the matched object to matchingFieldsObject and stop further checks
            if (allFieldsMatch) {
                matchingFieldsObject = matchedFields; // Store the first matching set
                return; // Break out of the loop (no need to check further arrays)
            }
        });
        matchingFieldsObject['PayerID'] = newObj['PayerID'] ; 
        matchingFieldsObject['providerNpi'] = '1760626477'; 
        // Return the result after the loop finishes
        console.log('matchingFieldsObject:', matchingFieldsObject);
        return matchingFieldsObject;

    } catch (err) {
        console.error('Error:', err);
        return {}; // Return an empty object in case of an error
    }
};



const postCoverage = async (parsedInfo: any): Promise<any>  => {
    try{
        let bodyFormData = new FormData();

        const token = await authenticate();

        for(let key in parsedInfo){
            bodyFormData.append(key, parsedInfo[key]);
        }

        console.log('Coverage data:', bodyFormData);

        const res = await axios({
            url: `https://api.availity.com/availity/development-partner/v1/coverages`,
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            data: bodyFormData
        })
        const coverageId = res?.data?.id;
        const status = res?.data?.status;
        console.log('Coverage ID =', coverageId);
        console.log('Coverage Status =', status);

        return {coverageId, status};
    } catch(err){
        console.error(err);
        //throw new Error('Error while posting coverage data');   
    }
};

const getCoverage = async (CoverageId: string): Promise<any>  => {
    try{
        const token = await authenticate();
        const res = await axios({
            url: `https://api.availity.com/v1/coverages/${CoverageId}`,
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        })
        return res?.data;
    } catch(err){
        console.error(err);
    }
};

const checkCoverageStatus = async (coverageId: string): Promise<void> => {
    try {
      let polling = true;
  
      while (polling) {
        const res = await getCoverage(coverageId);
        let coverageStatus = res?.status;
        switch (coverageStatus) {
          case 'Complete':
            // let eligibilityStatus = res?.plans?.[0]?.status;
            polling = false;
            console.log('Eligibility response:', res?.plans?.[0]?.status);
            //return eligibilityStatus;
            break;
          case 'In Progress':
            console.log('Coverage status: In Progress');
            await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 1 second before retrying
            break;
  
          default:
            //eligibilityStatus = 'No active coverage found';
            console.log(`No active coverage found: ${coverageStatus}`);
            polling = false; // Stop the loop
            //return eligibilityStatus;
            break;
        }
      }
    } catch (error) {
      console.error('Error checking coverage status:', error);
    }
};

const getPatientEligibility = async(): Promise<any> => {
    try{
        //get the payerId from the patient's details
        const payerId = patientInfo.PayerID;
        console.log('Payer ID =', payerId);

        const reqFields = await getPayerConfigs(payerId);
        //console.log('Required Fields =' ,reqFields);

        const parsedInfo = parseReqFields(reqFields, patientInfo);

        const {coverageId, status } = await postCoverage(parsedInfo);

        // //Start checking coverage status
        await checkCoverageStatus(coverageId);
        // console.log('Eligibility status:', eligibilityStatus);

    }catch(error){
        throw new Error(`${error}`);
    }    
}

getPatientEligibility();







