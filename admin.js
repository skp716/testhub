import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* --------------------------------------------------
   FIREBASE CONFIG
-------------------------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyB-example-key",
  authDomain: "testhub-43fd8.firebaseapp.com",
  projectId: "testhub-43fd8",
  storageBucket: "testhub-43fd8.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:000000000000"
};

/*
  IMPORTANT:
  Apne Firebase Project Settings se original config
  yahan paste karein agar upar wala config placeholder hai.
*/

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* --------------------------------------------------
   ADMIN EMAIL ALLOWLIST
-------------------------------------------------- */

const ADMIN_EMAILS = [
  "abc@gmail.com"
];

/*
  Is email ko apne actual Firebase Authentication
  admin email se replace karein.
*/

let currentUser = null;
let allResults = [];
let allAttempts = [];
let allSecurity = [];
let currentLogoData = "";

/* --------------------------------------------------
   DOM HELPERS
-------------------------------------------------- */

const $ = id => document.getElementById(id);

function showMessage(element, text, type = "normal") {
  if (!element) return;

  element.textContent = text;
  element.classList.remove("hidden", "error", "success-msg");

  if (type === "error") {
    element.classList.add("error");
  }

  if (type === "success") {
    element.classList.add("success-msg");
  }
}

function hideMessage(element) {
  if (element) {
    element.textContent = "";
    element.classList.add("hidden");
  }
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeText(value, fallback = "") {
  return value === undefined || value === null
    ? fallback
    : String(value);
}

function formatDate(value) {
  if (!value) return "-";

  try {
    if (typeof value.toDate === "function") {
      return value.toDate().toLocaleString("en-IN");
    }

    if (value.seconds) {
      return new Date(value.seconds * 1000).toLocaleString("en-IN");
    }

    return new Date(value).toLocaleString("en-IN");
  } catch {
    return "-";
  }
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* --------------------------------------------------
   LOGIN
-------------------------------------------------- */

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Logging in...";
  hideMessage($("loginMsg"));

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const loggedEmail = credential.user.email.toLowerCase();

    if (
      ADMIN_EMAILS.length > 0 &&
      !ADMIN_EMAILS.map(item => item.toLowerCase()).includes(loggedEmail)
    ) {
      await signOut(auth);
      throw new Error("This account is not authorized as administrator.");
    }

    showMessage($("loginMsg"), "Login successful.", "success");
  } catch (error) {
    showMessage(
      $("loginMsg"),
      `Login failed: ${error.message}`,
      "error"
    );
  } finally {
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Login";
  }
});

$("logout").addEventListener("click", async () => {
  await signOut(auth);
});

/* --------------------------------------------------
   AUTH STATE
-------------------------------------------------- */

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }

  const email = safeText(user.email).toLowerCase();

  if (
    ADMIN_EMAILS.length > 0 &&
    !ADMIN_EMAILS.map(item => item.toLowerCase()).includes(email)
  ) {
    await signOut(auth);
    showMessage(
      $("loginMsg"),
      "This account is not authorized as administrator.",
      "error"
    );
    return;
  }

  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");

  $("adminLabel").textContent =
    `Logged in as ${user.email}`;

  await loadEverything();
});

/* --------------------------------------------------
   TABS
-------------------------------------------------- */

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => {
      item.classList.remove("active");
    });

    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.remove("active");
    });

    button.classList.add("active");

    const panelId = button.dataset.panel;
    $(panelId).classList.add("active");
  });
});

/* --------------------------------------------------
   LOAD ALL DATA
-------------------------------------------------- */

async function loadEverything() {
  await Promise.all([
    loadConfig(),
    loadResults(),
    loadAttempts(),
    loadSecurity()
  ]);

  renderResults();
  renderAttempts();
  renderSecurity();
  updateStats();
}

/* --------------------------------------------------
   CONFIGURATION
-------------------------------------------------- */

async function loadConfig() {
  try {
    const configRef = doc(db, "adminConfig", "main");
    const snapshot = await getDoc(configRef);

    if (!snapshot.exists()) return;

    const data = snapshot.data();

    $("instituteName").value =
      safeText(data.instituteName, "TestHub");

    $("instituteLogo").value =
      safeText(data.instituteLogo);

    $("examTitle").value =
      safeText(data.examTitle, "RRB Group D Examination");

    $("durationMinutes").value =
      safeNumber(data.durationMinutes, 90);

    $("negativeMarking").value =
      safeNumber(data.negativeMarking, 0);

    $("tabPenalty").value =
      safeNumber(data.tabPenalty, 0);

    $("maxTabSwitches").value =
      safeNumber(data.maxTabSwitches, 5);

    $("centerCode").value =
      safeText(data.centerCode);

    $("instituteLocation").value =
      safeText(data.instituteLocation);

    $("fullAddress").value =
      safeText(data.fullAddress);

    $("totalPool").value =
      safeNumber(data.totalPool, 100);

    $("studentLimit").value =
      safeNumber(data.studentLimit, 100);

    $("subjectName").value =
      safeText(data.subjectName, "All Questions");

    $("questionSource").value =
      safeText(data.questionSource, "chapter.json");

    $("questionOrder").value =
      safeText(data.questionOrder, "random");

    $("windowStart").value =
      safeText(data.windowStart);

    $("windowEnd").value =
      safeText(data.windowEnd);

    $("examActive").value =
      String(data.examActive !== false);

    $("replaceQuestionOnSwitch").checked =
      Boolean(data.replaceQuestionOnSwitch);

    if (data.uploadMethod) {
      const radio = document.querySelector(
        `input[name="uploadMethod"][value="${data.uploadMethod}"]`
      );

      if (radio) radio.checked = true;
    }

    if (Array.isArray(data.activeExams)) {
      document.querySelectorAll(".active-exam").forEach(box => {
        box.checked = data.activeExams.includes(box.value);
      });
    }

    if (data.instituteLogo) {
      currentLogoData = data.instituteLogo;
      showLogo(data.instituteLogo);
    }
  } catch (error) {
    console.error("Config loading error:", error);
  }
}

function collectConfig() {
  const activeExams = Array.from(
    document.querySelectorAll(".active-exam:checked")
  ).map(box => box.value);

  const uploadMethod =
    document.querySelector(
      'input[name="uploadMethod"]:checked'
    )?.value || "live_form";

  return {
    instituteName: $("instituteName").value.trim(),
    instituteLogo: currentLogoData || $("instituteLogo").value.trim(),
    examTitle: $("examTitle").value.trim(),
    examSelect: $("examSelect").value,
    activeExams,

    durationMinutes: safeNumber($("durationMinutes").value, 90),
    negativeMarking: safeNumber($("negativeMarking").value, 0),
    tabPenalty: safeNumber($("tabPenalty").value, 0),
    maxTabSwitches: safeNumber($("maxTabSwitches").value, 5),

    totalPool: safeNumber($("totalPool").value, 100),
    studentLimit: safeNumber($("studentLimit").value, 100),
    subjectName: $("subjectName").value.trim(),
    questionSource: $("questionSource").value.trim(),
    questionOrder: $("questionOrder").value,

    centerCode: $("centerCode").value.trim(),
    instituteLocation: $("instituteLocation").value.trim(),
    fullAddress: $("fullAddress").value.trim(),

    windowStart: $("windowStart").value,
    windowEnd: $("windowEnd").value,
    examActive: $("examActive").value === "true",

    uploadMethod,
    replaceQuestionOnSwitch: $("replaceQuestionOnSwitch").checked,

    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  };
}

$("saveConfig").addEventListener("click", async () => {
  const button = $("saveConfig");
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const config = collectConfig();

    await setDoc(
      doc(db, "adminConfig", "main"),
      config,
      { merge: true }
    );

    await setDoc(
      doc(db, "examConfigs", config.examSelect),
      {
        ...config,
        examId: config.examSelect
      },
      { merge: true }
    );

    showMessage(
      $("configMsg"),
      "Exam and subject settings saved successfully.",
      "success"
    );
  } catch (error) {
    showMessage(
      $("configMsg"),
      `Unable to save settings: ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "💾 Save Exam & Subject Settings";
  }
});

$("activateCenter").addEventListener("click", async () => {
  const centerCode = $("centerCode").value.trim();

  if (!centerCode) {
    showMessage(
      $("centerMsg"),
      "Please enter a center code first.",
      "error"
    );
    return;
  }

  try {
    await setDoc(
      doc(db, "adminConfig", "main"),
      {
        centerCode,
        instituteName: $("instituteName").value.trim(),
        instituteLocation: $("instituteLocation").value.trim(),
        fullAddress: $("fullAddress").value.trim(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showMessage(
      $("centerMsg"),
      `Center code ${centerCode} activated successfully.`,
      "success"
    );
  } catch (error) {
    showMessage(
      $("centerMsg"),
      `Center activation failed: ${error.message}`,
      "error"
    );
  }
});

$("saveAvailability").addEventListener("click", async () => {
  try {
    const uploadMethod =
      document.querySelector(
        'input[name="uploadMethod"]:checked'
      )?.value || "live_form";

    await setDoc(
      doc(db, "adminConfig", "main"),
      {
        windowStart: $("windowStart").value,
        windowEnd: $("windowEnd").value,
        examActive: $("examActive").value === "true",
        uploadMethod,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showMessage(
      $("availabilityMsg"),
      "Availability and upload settings saved successfully.",
      "success"
    );
  } catch (error) {
    showMessage(
      $("availabilityMsg"),
      `Unable to save availability: ${error.message}`,
      "error"
    );
  }
});

$("addSubject").addEventListener("click", () => {
  alert(
    "Subject-wise multiple rows ka complete dynamic version next update me add kiya ja sakta hai. Abhi current subject settings save ho rahi hain."
  );
});

/* --------------------------------------------------
   LOGO
-------------------------------------------------- */

$("instituteLogo").addEventListener("input", event => {
  const url = event.target.value.trim();

  if (url) {
    currentLogoData = url;
    showLogo(url);
  }
});

$("logoFile").addEventListener("change", event => {
  const file = event.target.files[0];

  if (!file) return;

  if (file.size > 500 * 1024) {
    alert("Logo size 500 KB se kam hona chahiye.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    currentLogoData = reader.result;
    showLogo(reader.result);
  };

  reader.readAsDataURL(file);
});

$("clearLogo").addEventListener("click", () => {
  currentLogoData = "";
  $("instituteLogo").value = "";
  $("logoFile").value = "";
  $("logoPreview").src = "";
  $("logoPreview").classList.add("hidden");
});

function showLogo(url) {
  if (!url) return;

  $("logoPreview").src = url;
  $("logoPreview").classList.remove("hidden");
}

/* --------------------------------------------------
   RESULTS
-------------------------------------------------- */

async function loadResults() {
  allResults = [];

  const possibleCollections = [
    "results",
    "submissions"
  ];

  for (const collectionName of possibleCollections) {
    try {
      const snapshot = await getDocs(
        collection(db, collectionName)
      );

      snapshot.forEach(item => {
        allResults.push({
          id: item.id,
          collectionName,
          ...item.data()
        });
      });

      if (allResults.length > 0) break;
    } catch (error) {
      console.warn(
        `Unable to load ${collectionName}:`,
        error.message
      );
    }
  }
}

function normalizeResult(item) {
  return {
    id: item.id,
    collectionName: item.collectionName,

    name: safeText(
      item.name || item.studentName || item.candidateName,
      "Unknown"
    ),

    email: safeText(
      item.email || item.studentEmail || item.candidateEmail
    ),

    exam: safeText(
      item.exam || item.examTitle || item.examName,
      "General Exam"
    ),

    center: safeText(
      item.center || item.centerCode
    ),

    score: safeNumber(
      item.score || item.finalScore || item.marks,
      0
    ),

    correct: safeNumber(
      item.correct || item.correctCount,
      0
    ),

    wrong: safeNumber(
      item.wrong || item.wrongCount,
      0
    ),

    attempted: safeNumber(
      item.attempted || item.attemptedCount,
      0
    ),

    rating: safeNumber(
      item.rating || item.stars,
      0
    ),

    violations: safeNumber(
      item.violations || item.securityCount || item.tabSwitches,
      0
    ),

    submittedAt:
      item.submittedAt ||
      item.completedAt ||
      item.createdAt ||
      item.timestamp,

    raw: item
  };
}

function renderResults() {
  const tbody = $("resultRows");
  tbody.innerHTML = "";

  let rows = allResults.map(normalizeResult);

  const search = $("resultSearch").value.trim().toLowerCase();
  const sort = $("resultSort").value;

  if (search) {
    rows = rows.filter(row =>
      row.name.toLowerCase().includes(search) ||
      row.email.toLowerCase().includes(search) ||
      row.exam.toLowerCase().includes(search)
    );
  }

  if (sort === "score") {
    rows.sort((a, b) => b.score - a.score);
  }

  if (sort === "rating") {
    rows.sort((a, b) => b.rating - a.rating);
  }

  if (sort === "newest") {
    rows.sort((a, b) => {
      return getTime(b.submittedAt) - getTime(a.submittedAt);
    });
  }

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty">
          No result data available.
        </td>
      </tr>
    `;
    return;
  }

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><b>${index + 1}</b></td>

      <td>
        <b>${escapeHtml(row.name)}</b><br>
        <span class="muted">${escapeHtml(row.email)}</span>
      </td>

      <td>${escapeHtml(row.exam)}</td>

      <td>${escapeHtml(row.center || "-")}</td>

      <td>
        <span class="badge blue">
          ${row.score}
        </span>
      </td>

      <td>${row.correct}</td>
      <td>${row.wrong}</td>
      <td>${row.attempted}</td>

      <td>${formatDate(row.submittedAt)}</td>

      <td>
        ${row.rating > 0 ? `${row.rating}/5` : "-"}
      </td>

      <td>
        <button class="btn outline view-result"
                data-id="${row.id}">
          View
        </button>

        <button class="btn danger delete-result"
                data-id="${row.id}"
                data-collection="${row.collectionName}">
          Delete
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll(".view-result").forEach(button => {
    button.addEventListener("click", () => {
      const row = rows.find(item => item.id === button.dataset.id);
      if (row) openResultDetails(row);
    });
  });

  document.querySelectorAll(".delete-result").forEach(button => {
    button.addEventListener("click", async () => {
      const confirmed = confirm(
        "Kya aap is result ko permanently delete karna chahte hain?"
      );

      if (!confirmed) return;

      try {
        await deleteDoc(
          doc(
            db,
            button.dataset.collection,
            button.dataset.id
          )
        );

        await loadEverything();
      } catch (error) {
        alert(`Delete failed: ${error.message}`);
      }
    });
  });
}

function getTime(value) {
  if (!value) return 0;

  try {
    if (typeof value.toDate === "function") {
      return value.toDate().getTime();
    }

    if (value.seconds) {
      return value.seconds * 1000;
    }

    return new Date(value).getTime() || 0;
  } catch {
    return 0;
  }
}

/* --------------------------------------------------
   LIVE ATTEMPTS
-------------------------------------------------- */

async function loadAttempts() {
  allAttempts = [];

  try {
    const snapshot = await getDocs(
      collection(db, "attempts")
    );

    snapshot.forEach(item => {
      allAttempts.push({
        id: item.id,
        ...item.data()
      });
    });
  } catch (error) {
    console.warn("Attempts loading error:", error.message);
  }
}

function renderAttempts() {
  const tbody = $("attemptRows");
  tbody.innerHTML = "";

  const activeRows = allAttempts.filter(item => {
    const status = safeText(item.status, "active").toLowerCase();
    return !["submitted", "completed", "finished"].includes(status);
  });

  if (activeRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">
          No active attempts found.
        </td>
      </tr>
    `;
    return;
  }

  activeRows.forEach(item => {
    const name = item.name || item.studentName || "Unknown";
    const email = item.email || item.studentEmail || "-";
    const exam = item.exam || item.examTitle || "-";
    const status = item.status || "Active";
    const question = item.currentQuestion || item.questionNumber || "-";
    const violations = item.violations || item.tabSwitches || 0;
    const penalty = item.penalty || item.penaltyCount || 0;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(exam)}</td>
      <td><span class="badge good">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(question)}</td>
      <td>${violations}</td>
      <td>${penalty}</td>
      <td>${formatDate(item.updatedAt || item.lastUpdated)}</td>
    `;

    tbody.appendChild(tr);
  });
}

/* --------------------------------------------------
   SECURITY ANALYTICS
-------------------------------------------------- */

async function loadSecurity() {
  allSecurity = [];

  const possibleCollections = [
    "securityLogs",
    "security",
    "violations"
  ];

  for (const collectionName of possibleCollections) {
    try {
      const snapshot = await getDocs(
        collection(db, collectionName)
      );

      snapshot.forEach(item => {
        allSecurity.push({
          id: item.id,
          collectionName,
          ...item.data()
        });
      });

      if (allSecurity.length > 0) break;
    } catch (error) {
      console.warn(
        `Unable to load ${collectionName}:`,
        error.message
      );
    }
  }
}

function renderSecurity() {
  const tbody = $("securityRows");
  tbody.innerHTML = "";

  if (allSecurity.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty">
          No security analytics data available.
        </td>
      </tr>
    `;

    $("violations").textContent = "0";
    $("tabTotal").textContent = "0";
    $("copyTotal").textContent = "0";
    $("penaltyTotal").textContent = "0";

    return;
  }

  let totalTabs = 0;
  let totalCopy = 0;
  let totalPenalty = 0;

  allSecurity.forEach(item => {
    const name = item.name || item.studentName || "Unknown";
    const email = item.email || item.studentEmail || "-";

    const tabs = safeNumber(
      item.tabSwitches || item.tabs || item.tabEvents,
      0
    );

    const copy = safeNumber(
      item.copyEvents || item.copy || item.otherEvents,
      0
    );

    const total = safeNumber(
      item.totalEvents || item.total || tabs + copy,
      tabs + copy
    );

    const penalty = safeNumber(
      item.penalty || item.penaltyCount,
      0
    );

    const autoSubmitted =
      item.autoSubmitted === true ||
      item.status === "auto-submitted";

    totalTabs += tabs;
    totalCopy += copy;
    totalPenalty += penalty;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(email)}</td>
      <td>${tabs}</td>
      <td>${copy}</td>
      <td>${total}</td>
      <td>${penalty}</td>
      <td>
        <span class="badge ${autoSubmitted ? "bad" : "good"}">
          ${autoSubmitted ? "Yes" : "No"}
        </span>
      </td>
    `;

    tbody.appendChild(tr);
  });

  $("violations").textContent = allSecurity.length;
  $("tabTotal").textContent = totalTabs;
  $("copyTotal").textContent = totalCopy;
  $("penaltyTotal").textContent = totalPenalty;
}

/* --------------------------------------------------
   STATISTICS
-------------------------------------------------- */

function updateStats() {
  const rows = allResults.map(normalizeResult);

  $("submissions").textContent = rows.length;

  const activeRows = allAttempts.filter(item => {
    const status = safeText(item.status, "active").toLowerCase();
    return !["submitted", "completed", "finished"].includes(status);
  });

  $("active").textContent = activeRows.length;

  if (rows.length === 0) {
    $("average").textContent = "0";
    $("ratingAvg").textContent = "0/5";
    return;
  }

  const totalScore = rows.reduce(
    (sum, item) => sum + item.score,
    0
  );

  const ratedRows = rows.filter(item => item.rating > 0);

  const totalRating = ratedRows.reduce(
    (sum, item) => sum + item.rating,
    0
  );

  $("average").textContent =
    (totalScore / rows.length).toFixed(2);

  $("ratingAvg").textContent =
    ratedRows.length > 0
      ? `${(totalRating / ratedRows.length).toFixed(2)}/5`
      : "0/5";
}

/* --------------------------------------------------
   RESULT DETAILS MODAL
-------------------------------------------------- */

function openResultDetails(row) {
  const raw = row.raw || {};

  $("detailContent").innerHTML = `
    <div class="grid-2">
      <div>
        <b>Student Name</b>
        <p>${escapeHtml(row.name)}</p>
      </div>

      <div>
        <b>Email</b>
        <p>${escapeHtml(row.email)}</p>
      </div>

      <div>
        <b>Exam</b>
        <p>${escapeHtml(row.exam)}</p>
      </div>

      <div>
        <b>Center</b>
        <p>${escapeHtml(row.center || "-")}</p>
      </div>

      <div>
        <b>Score</b>
        <p>${row.score}</p>
      </div>

      <div>
        <b>Correct Answers</b>
        <p>${row.correct}</p>
      </div>

      <div>
        <b>Wrong Answers</b>
        <p>${row.wrong}</p>
      </div>

      <div>
        <b>Attempted</b>
        <p>${row.attempted}</p>
      </div>

      <div>
        <b>Violations</b>
        <p>${row.violations}</p>
      </div>

      <div>
        <b>Submitted At</b>
        <p>${formatDate(row.submittedAt)}</p>
      </div>
    </div>

    <hr>

    <h3>Complete Stored Data</h3>
    <pre style="white-space:pre-wrap;background:#f8fafc;padding:14px;border-radius:10px;overflow:auto">${escapeHtml(
      JSON.stringify(raw, null, 2)
    )}</pre>
  `;

  $("detailModal").classList.remove("hidden");
}

$("closeModal").addEventListener("click", () => {
  $("detailModal").classList.add("hidden");
});

$("detailModal").addEventListener("click", event => {
  if (event.target === $("detailModal")) {
    $("detailModal").classList.add("hidden");
  }
});

/* --------------------------------------------------
   SEARCH / SORT / REFRESH
-------------------------------------------------- */

$("resultSearch").addEventListener("input", renderResults);
$("resultSort").addEventListener("change", renderResults);

$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  $("refresh").textContent = "Refreshing...";

  try {
    await loadEverything();
  } finally {
    $("refresh").disabled = false;
    $("refresh").textContent = "Refresh";
  }
});

/* --------------------------------------------------
   CSV EXPORT
-------------------------------------------------- */

$("csv").addEventListener("click", () => {
  const rows = allResults.map(normalizeResult);

  if (rows.length === 0) {
    alert("Export karne ke liye koi result available nahi hai.");
    return;
  }

  const header = [
    "Rank",
    "Name",
    "Email",
    "Exam",
    "Center",
    "Score",
    "Correct",
    "Wrong",
    "Attempted",
    "Rating",
    "Violations",
    "Submitted At"
  ];

  const data = rows
    .sort((a, b) => b.score - a.score)
    .map((row, index) => [
      index + 1,
      row.name,
      row.email,
      row.exam,
      row.center,
      row.score,
      row.correct,
      row.wrong,
      row.attempted,
      row.rating,
      row.violations,
      formatDate(row.submittedAt)
    ]);

  const csvContent = [
    header,
    ...data
  ]
    .map(row =>
      row
        .map(value =>
          `"${safeText(value).replaceAll('"', '""')}"`
        )
        .join(",")
    )
    .join("\n");

  const blob = new Blob(
    [csvContent],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "testhub-results.csv";
  link.click();

  URL.revokeObjectURL(url);
});

/* --------------------------------------------------
   CLEAR RESULTS
-------------------------------------------------- */

$("clearResults").addEventListener("click", async () => {
  if (allResults.length === 0) {
    alert("Delete karne ke liye koi result nahi hai.");
    return;
  }

  const confirmed = confirm(
    "WARNING: Kya aap sabhi results permanently delete karna chahte hain?"
  );

  if (!confirmed) return;

  try {
    const batch = writeBatch(db);

    allResults.forEach(item => {
      batch.delete(
        doc(db, item.collectionName, item.id)
      );
    });

    await batch.commit();

    alert("All results deleted successfully.");
    await loadEverything();
  } catch (error) {
    alert(`Unable to clear results: ${error.message}`);
  }
});
