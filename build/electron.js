const path = require("path");
const { Configuration, OpenAIApi } = require("openai");
const fs = require("fs");
const csvStringify = require("csv-stringify");
const csvParser = require("csv-parser");
const Bottleneck = require("bottleneck");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

let totalAmountOfBiosNeeded = 0;
let totalAmountOfBiosCompleted = 0;

const readInputFromCSV = (filename) => {
  return new Promise((resolve, reject) => {
    let results = [];
    fs.createReadStream(filename)
      .pipe(csvParser({ headers: false }))
      .on("data", (data) => results.push(Object.values(data)))
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error));
  });
};

const convertArrayToObject = (inputArray) => {
  const result = {};

  // Name
  result.name = `${inputArray[1]} ${inputArray[2] ? inputArray[2] + "." : ""} ${
    inputArray[3]
  }${inputArray[4] ? ", " + inputArray[4] : ""}${
    inputArray[5] ? ", " + inputArray[5] : ""
  }`;

  // Specialties
  const specialties = [];
  for (let i = 78; i <= 88; i++) {
    if (inputArray[i]) {
      specialties.push(inputArray[i]);
    }
  }
  result.specialties = specialties.join(", ");

  // Interests
  const interests = [];
  for (let i = 67; i <= 77; i++) {
    if (inputArray[i]) {
      interests.push(inputArray[i]);
    }
  }
  result.interests = interests.join(", ");

  // Affiliations
  result.affiliations = inputArray[13];

  // Gender
  result.gender = inputArray[6] === "M" ? "Male" : "Female";

  // Languages
  // Assuming the default language is English if none is provided
  const languages = [];
  for (let i = 77; i <= 80; i++) {
    if (inputArray[i]) {
      languages.push(inputArray[i]);
    }
  }
  if (!result.languages) languages.push("English");
  result.languages = languages.join(", ");

  // Certifications
  const certs = [];
  for (let i = 62; i <= 66; i++) {
    if (inputArray[i]) {
      certs.push(inputArray[i]);
    }
  }
  result.certs = certs.join(", ");

  // Medical School
  result.medicalSchool = `${inputArray[92]}, ${inputArray[93]}, ${inputArray[94]}, ${inputArray[95]}`;

  // Fellowships
  const fellowships = [];
  for (let i = 111; i <= 114; i += 2) {
    if (inputArray[i]) {
      fellowships.push(inputArray[i]);
    }
  }
  result.fellowships = fellowships.length ? fellowships.join(", ") : "";

  // Fellowships
  const residency = [];
  for (let i = 107; i <= 110; i += 2) {
    if (inputArray[i]) {
      residency.push(inputArray[i]);
    }
  }
  result.residency = residency.length ? residency.join(", ") : "";

  // Clinical Titles
  const clinicalTitles = [];
  for (let i = 115; i <= 116; i++) {
    if (inputArray[i]) {
      clinicalTitles.push(inputArray[i]);
    }
  }
  result.clinicalTitles = clinicalTitles.join(" | ");

  // Academic Titles
  result.academicTitles = inputArray[114];

  return result;
};

const generateBio = async (doctor, openai, event) => {
  const formattedDoctor = convertArrayToObject(doctor);

  const prompt = `Generate a warm and concise bio for a doctor:
  Name: ${formattedDoctor.name}
  Specialties (Weight: 9): ${formattedDoctor.specialties}
  Outside Work Curiosities (Weight: 1, Optional): ${formattedDoctor.interests}
  Affiliations (Weight: 3): ${formattedDoctor.affiliations}
  Gender (Weight: 4): ${formattedDoctor.gender}
  Languages (Weight: 5): ${formattedDoctor.languages}
  Board Certs (Weight: 6): ${formattedDoctor.certs}
  Medical School (Weight: 6): ${formattedDoctor.medicalSchool}
  Fellowships (Weight: 2, Optional): ${formattedDoctor.fellowships}
  Residency (Weight: 6): ${formattedDoctor.residency}
  Clinical Titles (Weight: 8): ${formattedDoctor.clinicalTitles}
  Academic Titles (Weight: 3, Optional): ${formattedDoctor.academicTitles}
  
  Write a warm and short (1-3 sentences) bio. Use weights (1-10) to guide the content. Please focus on their current expertise and qualifications without providing specific services or assuming information that hasn't been provided.`;

  totalAmountOfBiosCompleted += 1;
  event.sender.send("progress-update", {
    progress: (totalAmountOfBiosCompleted / totalAmountOfBiosNeeded) * 100,
  });

  const completion = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: prompt,
    max_tokens: 200,
  });

  const bio = completion.data.choices[0].text.trim();

  totalAmountOfBiosCompleted += 1;
  console.log(`Bio genereated for ${formattedDoctor.name}`);
  event.sender.send("progress-update", {
    progress: (totalAmountOfBiosCompleted / totalAmountOfBiosNeeded) * 100,
  });

  return bio;
};

const combineDoctorsAndBios = (doctors, bios, directoryPath) => {
  let docsAndBios = [["NPI Number", "Name", "Bio"]];

  for (let i = 0; i < doctors.length; i++) {
    const npiNumber = doctors[i][0];

    const doctorName = `${doctors[i][1]} ${
      doctors[i][2] ? doctors[i][2] + "." : ""
    } ${doctors[i][3]}${doctors[i][4] ? ", " + doctors[i][4] : ""}${
      doctors[i][5] ? ", " + doctors[i][5] : ""
    }`;

    const bio = bios[i];

    docsAndBios.push([npiNumber, doctorName, bio]);
  }

  csvStringify.stringify(docsAndBios, (err, output) => {
    fs.writeFileSync(`${directoryPath}/output.csv`, output);
    console.log(`Output written to ${directoryPath}/output.csv`);
  });

  return docsAndBios;
};

const generateBios = async (exportFile, openai, directoryPath, event) => {
  const doctors = await readInputFromCSV(exportFile);
  doctors.shift();
  totalAmountOfBiosNeeded = doctors.length * 2;

  // Set up the rate limiter
  const averageTokensPerRequest = 1000; // Change this based on your average tokens per request
  const minTime = (60 / (250000 / averageTokensPerRequest)) * 1000;

  const limiter = new Bottleneck({
    minTime, // Number of milliseconds to wait between API calls
    maxConcurrent: 2000, // Maximum concurrent requests
  });

  // Loop through doctors and create all bio generation promises
  const bioPromises = doctors.map((doctor) =>
    limiter.schedule(() => generateBio(doctor, openai, event))
  );

  // Wait for all promises to resolve
  const bios = await Promise.all(bioPromises);

  // Combine the doctors with their bios
  combineDoctorsAndBios(doctors, bios, directoryPath);

  return;
};

ipcMain.handle("open-file-dialog-for-csv", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (!result.canceled) {
    return result.filePaths[0];
  } else {
    return null;
  }
});

ipcMain.handle("run-generation", async (event, data) => {
  const { apiKey, exportFilePath, directoryPath } = data;

  const configuration = new Configuration({
    apiKey,
  });

  const openai = new OpenAIApi(configuration);

  await generateBios(exportFilePath, openai, directoryPath, event);

  return { status: "completed" };
});

ipcMain.on("open-csv-file", (event, filePath) => {
  shell.openPath(filePath);
});

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });

  // and load the index.html of the app.
  // win.loadFile("index.html");
  // `file://${path.join(__dirname, "../build/index.html")}`
  win.loadURL(`file://${path.join(__dirname, "../build/index.html")}`);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
