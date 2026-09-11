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
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";


/* =========================================================
   FIREBASE
========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyBp1JrZy_dsJbXmg0jPfZrVEg7vlMbwRkM",
  authDomain: "testhub-43fd8.firebaseapp.com",
  projectId: "testhub-43fd8",
  storageBucket: "testhub-43fd8.firebasestorage.app",
  messagingSenderId: "530965492161",
  appId: "1:530965492161:web:b8ea984ef0c9cb14763f40"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let currentUser = null;
let config = {};
let results = [];
let attempts = [];
let unsubs = [];
let logoData = "";


/* =========================================================
   HELPERS
========================================================= */

const millis = value =>
  value?.toMillis
    ? value.toMillis()
    : value?.seconds
      ? value.seconds * 1000
      : typeof value === "number"
        ? value
        : Date.parse(value) || 0;

const formatDate = value =>
  millis(value)
    ? new Date(millis(value)).toLocaleString("en-IN")
    : "-";

const localDate = value => {
  const n = millis(value);

  if (!n) return "";

  const d = new Date(n);

  return new Date(
    d - d.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);
};

const escapeHtml = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );

function message(id, text, error = false) {
  const element = $(id);

  if (!element) return;

  element.textContent = text;
  element.className =
    `msg${error ? " error" : " success-msg"}`;

  element.classList.remove("hidden");
}

function number(id, fallback = 0) {
  const value = Number($(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}


/* =========================================================
   ADMIN SECURITY
========================================================= */

async function isAdmin(user) {

  if (!user) return false;

  try {

    const snap = await getDoc(
      doc(db, "admin", user.uid)
    );

    const data = snap.data() || {};

    return (
      snap.exists() &&
      data.active === true &&
      ["admin", "super_admin"].includes(
        data.role || "admin"
      )
    );

  } catch (error) {

    console.error("Admin verification failed:", error);

    return false;
  }
}


/* =========================================================
   LOGIN
========================================================= */

$("loginForm").onsubmit = async event => {

  event.preventDefault();

  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Logging in...";

  try {

    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim().toLowerCase(),
      $("password").value
    );

  } catch (error) {

    message(
      "loginMsg",
      "Login failed: " + error.message,
      true
    );

  } finally {

    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Login";
  }
};


/* =========================================================
   AUTH STATE
========================================================= */

onAuthStateChanged(auth, async user => {

  unsubs.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  unsubs = [];

  if (!user) {

    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");

    return;
  }

  const allowed = await isAdmin(user);

  if (!allowed) {

    await signOut(auth);

    message(
      "loginMsg",
      "This Firebase account is not authorized in admin/{uid}.",
      true
    );

    return;
  }

  currentUser = user;

  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");

  $("adminLabel").textContent =
    user.email || user.uid;

  await loadConfig();
  subscribe();
});


/* =========================================================
   LOGOUT / REFRESH
========================================================= */

$("logout").onclick = () => signOut(auth);

$("refresh").onclick = async () => {

  await loadConfig();

  subscribe();
};


/* =========================================================
   TABS
========================================================= */

document.querySelectorAll(".tab").forEach(button => {

  button.onclick = () => {

    document
      .querySelectorAll(".tab")
      .forEach(item =>
        item.classList.remove("active")
      );

    document
      .querySelectorAll(".panel")
      .forEach(panel =>
        panel.classList.remove("active")
      );

    button.classList.add("active");

    const panel =
      $(button.dataset.panel);

    if (panel) {
      panel.classList.add("active");
    }
  };

});


/* =========================================================
   ACTIVE EXAMS
========================================================= */

function updateActiveExamStyle() {

  document
    .querySelectorAll(".exam-pill")
    .forEach(pill => {

      const checkbox =
        pill.querySelector(".active-exam");

      if (!checkbox) return;

      pill.classList.toggle(
        "active",
        checkbox.checked
      );
    });

  updateSummary();
}


document
  .querySelectorAll(".active-exam")
  .forEach(input => {

    input.onchange =
      updateActiveExamStyle;

  });


/* =========================================================
   SUBJECT MANAGEMENT
========================================================= */

function addSubject(data = {}) {

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "subject-row";

  wrapper.innerHTML = `
    <div>
      <label>Subject Name *</label>
      <input
        class="s-name"
        value="${escapeHtml(
          data.name || "All Questions"
        )}"
      >
    </div>

    <div>
      <label>Questions *</label>
      <input
        class="s-count"
        type="number"
        min="1"
        value="${Number(data.count) || 100}"
      >
    </div>

    <div>
      <label>Question Source *</label>
      <input
        class="s-source"
        value="${escapeHtml(
          data.source || "chapter.json"
        )}"
      >
    </div>

    <div>
      <label>Question Order *</label>
      <select class="s-order">
        <option value="random">Random</option>
        <option value="sequential">Sequential</option>
      </select>
    </div>

    <button
      type="button"
      class="btn danger remove-subject"
    >
      🗑
    </button>
  `;

  const order =
    wrapper.querySelector(".s-order");

  order.value =
    data.order === "sequential"
      ? "sequential"
      : "random";

  wrapper
    .querySelector(".remove-subject")
    .onclick = () => {

      wrapper.remove();

      if (!$("subjectRows").children.length) {

        addSubject({
          name: "All Questions",
          count: 100,
          source: "chapter.json",
          order: "random"
        });

      }

      updateSummary();
    };

  wrapper
    .querySelectorAll("input,select")
    .forEach(input => {

      input.addEventListener(
        "input",
        updateSummary
      );

      input.addEventListener(
        "change",
        updateSummary
      );
    });

  $("subjectRows").appendChild(wrapper);

  updateSummary();
}


function getSubjects() {

  return [...document.querySelectorAll(
    ".subject-row"
  )]

    .map(row => ({

      name:
        row
          .querySelector(".s-name")
          .value
          .trim(),

      count:
        Number(
          row
            .querySelector(".s-count")
            .value
        ) || 0,

      source:
        row
          .querySelector(".s-source")
          .value
          .trim(),

      order:
        row
          .querySelector(".s-order")
          .value

    }))

    .filter(subject =>
      subject.name &&
      subject.count > 0 &&
      subject.source
    );
}


$("addSubject").onclick = () => {

  addSubject({
    name: "New Subject",
    count: 25,
    source: "chapter.json",
    order: "random"
  });

};


/* =========================================================
   SUMMARY
========================================================= */

function updateSummary() {

  const exam =
    $("examSelect")
      ?.selectedOptions?.[0]
      ?.textContent ||
    "Exam";

  const subjects =
    getSubjects();

  const total =
    subjects.reduce(
      (sum, subject) =>
        sum + subject.count,
      0
    );

  const active =
    [...document.querySelectorAll(
      ".active-exam:checked"
    )]
      .map(item =>
        item.value
          .replaceAll("_", " ")
          .toUpperCase()
      );

  if (!$("examSummary")) return;

  $("examSummary").innerHTML = `
    <b>${escapeHtml(exam)}:</b>
    ${subjects.length} section(s) •
    ${total} student questions •
    Timer:
    ${number("durationMinutes", 90)}
    min •
    Penalty:
    ${number("tabPenalty", 0)}
    /violation.
    <br>
    <b>Active:</b>
    ${
      active.length
        ? escapeHtml(active.join(", "))
        : "None"
    }
  `;
}


[
  "examSelect",
  "durationMinutes",
  "tabPenalty",
  "negativeMarking",
  "totalPool",
  "studentLimit"
].forEach(id => {

  $(id)?.addEventListener(
    "input",
    updateSummary
  );

});


/* =========================================================
   LOAD CONFIG
========================================================= */

async function loadConfig() {

  try {

    const snap =
      await getDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        )
      );

    config =
      snap.exists()
        ? snap.data()
        : {};

    $("examSelect").value =
      config.examId ||
      "rrb_group_d";

    $("durationMinutes").value =
      config.durationMinutes ?? 90;

    $("tabPenalty").value =
      config.tabPenalty ?? 0;

    $("negativeMarking").value =
      config.negativeMarking ?? 0;

    $("maxTabSwitches").value =
      config.maxTabSwitches ?? 5;

    $("centerCode").value =
      config.centerCode ?? "";

    $("instituteName").value =
      config.instituteName ?? "";

    $("instituteLocation").value =
      config.instituteLocation ?? "";

    $("fullAddress").value =
      config.fullAddress ?? "";

    $("examTitle").value =
      config.examTitle ?? "";

    $("windowStart").value =
      localDate(config.windowStart);

    $("windowEnd").value =
      localDate(config.windowEnd);

    $("examActive").value =
      String(config.examActive !== false);

    $("replaceQuestionOnSwitch").value =
      String(
        config.replaceQuestionOnSwitch !== false
      );

    logoData =
      config.instituteLogo || "";

    if (logoData) {

      $("logoPreview").src =
        logoData;

      $("logoPreview")
        .classList
        .remove("hidden");

      $("instituteLogo").value =
        logoData.startsWith("data:")
          ? ""
          : logoData;
    }

    const active =
      config.activeExams ||
      ["rrb_group_d"];

    document
      .querySelectorAll(".active-exam")
      .forEach(box => {

        box.checked =
          active.includes(box.value);

      });

    updateActiveExamStyle();

    document
      .querySelectorAll(
        'input[name="uploadMethod"]'
      )
      .forEach(radio => {

        radio.checked =
          radio.value ===
          (
            config.uploadMethod ||
            "live_form"
          );

      });

    $("subjectRows").innerHTML = "";

    const subjects =
      Array.isArray(config.subjects) &&
      config.subjects.length
        ? config.subjects
        : [
            {
              name:
                "All Questions",
              count:
                config.studentLimit ||
                100,
              source:
                config.questionSource ||
                "chapter.json",
              order:
                config.questionOrder ||
                "random"
            }
          ];

    subjects.forEach(addSubject);

    updateSummary();

    $("adminTitle").textContent =
      `${
        config.instituteName?.trim() ||
        "TestHub"
      } Admin`;

  } catch (error) {

    console.error(error);

    message(
      "configMsg",
      "Config load failed: " +
      error.message,
      true
    );
  }
}


/* =========================================================
   SAVE EXAM SETTINGS
========================================================= */

$("saveExamSettings").onclick =
  async () => {

    const subjects =
      getSubjects();

    const activeExams =
      [...document.querySelectorAll(
        ".active-exam:checked"
      )].map(input =>
        input.value
      );

    if (!activeExams.length) {

      return message(
        "subjectMsg",
        "Select at least one active exam.",
        true
      );
    }

    if (!subjects.length) {

      return message(
        "subjectMsg",
        "Add at least one valid subject.",
        true
      );
    }

    const start =
      $("windowStart").value;

    const end =
      $("windowEnd").value;

    if (
      start &&
      end &&
      new Date(start) >=
        new Date(end)
    ) {

      return message(
        "subjectMsg",
        "Start time must be earlier than close time.",
        true
      );
    }

    const total =
      subjects.reduce(
        (sum, subject) =>
          sum + subject.count,
        0
      );

    const payload = {

      examId:
        $("examSelect").value,

      activeExams,

      subjects,

      totalPool:
        total,

      studentLimit:
        total,

      durationMinutes:
        number("durationMinutes", 90),

      negativeMarking:
        number("negativeMarking", 0),

      tabPenalty:
        number("tabPenalty", 0),

      maxTabSwitches:
        number("maxTabSwitches", 5),

      autoSubmitAfter:
        number("maxTabSwitches", 5),

      replaceQuestionOnSwitch:
        $("replaceQuestionOnSwitch").value
        !== "false",

      examActive:
        $("examActive").value
        === "true",

      examTitle:
        $("examTitle").value.trim() ||
        $("examSelect")
          .selectedOptions[0]
          .textContent,

      questionSource:
        subjects[0]?.source ||
        "chapter.json",

      questionOrder:
        subjects[0]?.order ||
        "random",

      instituteName:
        $("instituteName")
          .value
          .trim() ||
        "TestHub",

      instituteLogo:
        logoData,

      centerCode:
        $("centerCode")
          .value
          .trim(),

      instituteLocation:
        $("instituteLocation")
          .value
          .trim(),

      fullAddress:
        $("fullAddress")
          .value
          .trim(),

      windowStart:
        start
          ? new Date(start).getTime()
          : 0,

      windowEnd:
        end
          ? new Date(end).getTime()
          : 0,

      uploadMethod:
        document.querySelector(
          'input[name="uploadMethod"]:checked'
        )?.value ||
        "live_form",

      updatedAt:
        serverTimestamp(),

      updatedBy:
        currentUser?.uid ||
        ""

    };

    try {

      await setDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        ),
        payload,
        {
          merge: true
        }
      );

      await setDoc(
        doc(
          db,
          "exam_config",
          payload.examId
        ),
        payload,
        {
          merge: true
        }
      );

      message(
        "subjectMsg",
        "Exam and subject settings saved successfully."
      );

      $("adminTitle").textContent =
        `${payload.instituteName} Admin`;

      updateSummary();

    } catch (error) {

      message(
        "subjectMsg",
        "Save failed: " +
        error.message,
        true
      );
    }
  };


/* =========================================================
   CENTER CODE
========================================================= */

$("activateCenter").onclick =
  async () => {

    const code =
      $("centerCode")
        .value
        .trim();

    if (!code) {

      return message(
        "centerMsg",
        "Enter a center code first.",
        true
      );
    }

    try {

      await setDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        ),
        {

          centerCode:
            code,

          instituteName:
            $("instituteName")
              .value
              .trim() ||
            "TestHub",

          instituteLocation:
            $("instituteLocation")
              .value
              .trim(),

          fullAddress:
            $("fullAddress")
              .value
              .trim(),

          updatedAt:
            serverTimestamp()

        },
        {
          merge: true
        }
      );

      message(
        "centerMsg",
        `Active center code: ${code}`
      );

    } catch (error) {

      message(
        "centerMsg",
        "Center activation failed: " +
        error.message,
        true
      );
    }
  };


/* =========================================================
   AVAILABILITY
========================================================= */

$("saveAvailability").onclick =
  async () => {

    const start =
      $("windowStart").value;

    const end =
      $("windowEnd").value;

    if (
      start &&
      end &&
      new Date(start) >=
        new Date(end)
    ) {

      return message(
        "availabilityMsg",
        "Start time must be earlier than close time.",
        true
      );
    }

    try {

      await setDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        ),
        {

          windowStart:
            start
              ? new Date(start).getTime()
              : 0,

          windowEnd:
            end
              ? new Date(end).getTime()
              : 0,

          maxTabSwitches:
            number("maxTabSwitches", 5),

          autoSubmitAfter:
            number("maxTabSwitches", 5),

          examActive:
            $("examActive").value
            === "true",

          uploadMethod:
            document.querySelector(
              'input[name="uploadMethod"]:checked'
            )?.value ||
            "live_form",

          updatedAt:
            serverTimestamp()

        },
        {
          merge: true
        }
      );

      message(
        "availabilityMsg",
        "Availability and upload settings saved successfully."
      );

    } catch (error) {

      message(
        "availabilityMsg",
        "Save failed: " +
        error.message,
        true
      );
    }
  };


/* =========================================================
   LOGO
========================================================= */

$("logoFile").onchange =
  event => {

    const file =
      event.target.files[0];

    if (!file) return;

    if (file.size > 500000) {

      alert(
        "Logo must be smaller than 500 KB."
      );

      event.target.value = "";

      return;
    }

    const reader =
      new FileReader();

    reader.onload = () => {

      logoData =
        reader.result;

      $("logoPreview").src =
        logoData;

      $("logoPreview")
        .classList
        .remove("hidden");
    };

    reader.readAsDataURL(file);
  };


$("instituteLogo").oninput =
  event => {

    const value =
      event.target.value.trim();

    logoData =
      value;

    if (value) {

      $("logoPreview").src =
        value;

      $("logoPreview")
        .classList
        .remove("hidden");

    }
  };


$("clearLogo").onclick =
  () => {

    logoData = "";

    $("instituteLogo").value = "";

    $("logoFile").value = "";

    $("logoPreview")
      .classList
      .add("hidden");

  };


/* =========================================================
   REALTIME DATA
========================================================= */

function subscribe() {

  unsubs.forEach(unsubscribe => {

    try {
      unsubscribe();
    } catch {}

  });

  unsubs = [];


  unsubs.push(
    onSnapshot(
      collection(db, "attempts"),
      snapshot => {

        attempts =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );

        renderAttempts();
        updateStats();
      }
    )
  );


  unsubs.push(
    onSnapshot(
      collection(db, "results"),
      snapshot => {

        results =
          snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );

        renderResults();
        renderSecurity();
        updateStats();
      }
    )
  );

}


/* =========================================================
   STATS
========================================================= */

function updateStats() {

  $("submissions").textContent =
    results.length;

  $("active").textContent =
    attempts.filter(
      attempt =>
        attempt.status ===
        "in_progress"
    ).length;

  if (!results.length) {

    $("average").textContent =
      "0";

    $("ratingAvg").textContent =
      "0/5";

    return;
  }

  const average =
    results.reduce(
      (sum, result) =>
        sum +
        (Number(result.score) || 0),
      0
    ) /
    results.length;

  $("average").textContent =
    average.toFixed(2);

  const rated =
    results.filter(
      result =>
        Number(result.rating) > 0
    );

  if (!rated.length) {

    $("ratingAvg").textContent =
      "0/5";

  } else {

    const avgRating =
      rated.reduce(
        (sum, result) =>
          sum +
          Number(result.rating),
        0
      ) /
      rated.length;

    $("ratingAvg").textContent =
      `${avgRating.toFixed(1)}/5`;
  }

  $("violations").textContent =
    results.filter(
      result =>
        Number(result.violationCount) > 0
    ).length;
}


/* =========================================================
   LIVE ATTEMPTS
========================================================= */

function renderAttempts() {

  const rows =
    [...attempts]
      .sort(
        (a, b) =>
          millis(b.updatedAt) -
          millis(a.updatedAt)
      );

  $("attemptRows").innerHTML =
    rows.map(attempt => `

      <tr>

        <td>
          ${escapeHtml(
            attempt.name || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            attempt.email || "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            attempt.exam ||
            attempt.examTitle ||
            config.examTitle ||
            "-"
          )}
        </td>

        <td>
          <span class="badge good">
            ${escapeHtml(
              attempt.status ||
              "active"
            )}
          </span>
        </td>

        <td>
          ${
            Number(
              attempt.currentIndex
            || 0
            ) + 1
          }
        </td>

        <td>
          ${
            Number(
              attempt.violationCount
            ) || 0
          }
        </td>

        <td>
          ${
            Number(
              attempt.penaltiesApplied
            ) || 0
          }
        </td>

        <td>
          ${formatDate(
            attempt.updatedAt
          )}
        </td>

      </tr>

    `).join("") ||

    `
      <tr>
        <td
          colspan="8"
          class="empty"
        >
          No live attempts.
        </td>
      </tr>
    `;
}


/* =========================================================
   RESULTS
========================================================= */

function filteredResults() {

  const query =
    $("resultSearch")
      .value
      .trim()
      .toLowerCase();

  const sort =
    $("resultSort").value;

  let rows =
    results.filter(result => {

      const searchable =
        `
          ${result.name || ""}
          ${result.email || ""}
          ${result.exam || ""}
          ${result.examTitle || ""}
        `.toLowerCase();

      return searchable.includes(
        query
      );
    });


  if (sort === "newest") {

    rows.sort(
      (a, b) =>
        millis(b.submittedAt) -
        millis(a.submittedAt)
    );

  } else if (sort === "rating") {

    rows.sort(
      (a, b) =>
        (Number(b.rating) || 0) -
        (Number(a.rating) || 0)
    );

  } else {

    rows.sort(
      (a, b) =>
        (Number(b.score) || 0) -
        (Number(a.score) || 0)
    );
  }

  return rows;
}


function renderResults() {

  const rows =
    filteredResults();

  $("resultRows").innerHTML =
    rows.map((result, index) => `

      <tr>

        <td>
          <b>#${index + 1}</b>
        </td>

        <td>
          <b>
            ${escapeHtml(
              result.name
            )}
          </b>

          <br>

          <span class="muted">
            ${escapeHtml(
              result.email
            )}
          </span>
        </td>

        <td>
          ${escapeHtml(
            result.exam ||
            result.examTitle ||
            "-"
          )}
        </td>

        <td>
          ${escapeHtml(
            result.center ||
            result.centerCode ||
            "-"
          )}
        </td>

        <td>

          <span class="badge blue">
            ${
              Number(result.score) || 0
            }/
            ${
              Number(result.total) || 0
            }
          </span>

        </td>

        <td>
          ${
            Number(result.correct) || 0
          }
        </td>

        <td>
          ${
            Number(result.wrong) || 0
          }
        </td>

        <td>
          ${
            (
              Number(result.correct) ||
              0
            ) +
            (
              Number(result.wrong) ||
              0
            )
          }
        </td>

        <td>
          ${formatDate(
            result.submittedAt
          )}
        </td>

        <td>
          ${
            result.rating
              ? escapeHtml(
                  result.rating
                ) + "/5"
              : "-"
          }
        </td>

        <td>

          <button
            class="btn light view-result"
            data-id="${result.id}"
          >
            View
          </button>

          <button
            class="btn danger delete-result"
            data-id="${result.id}"
          >
            Delete
          </button>

        </td>

      </tr>

    `).join("") ||

    `
      <tr>
        <td
          colspan="11"
          class="empty"
        >
          No results found.
        </td>
      </tr>
    `;


  document
    .querySelectorAll(".view-result")
    .forEach(button => {

      button.onclick =
        () =>
          showDetails(
            button.dataset.id
          );

    });


  document
    .querySelectorAll(".delete-result")
    .forEach(button => {

      button.onclick =
        async () => {

          if (
            !confirm(
              "Delete this result and attempt?"
            )
          ) {
            return;
          }

          try {

            await deleteDoc(
              doc(
                db,
                "results",
                button.dataset.id
              )
            );

            await deleteDoc(
              doc(
                db,
                "attempts",
                button.dataset.id
              )
            ).catch(() => {});

          } catch (error) {

            alert(
              error.message
            );
          }

        };

    });
}


$("resultSearch").oninput =
  renderResults;

$("resultSort").onchange =
  renderResults;


/* =========================================================
   RESULT DETAILS
========================================================= */

function showDetails(id) {

  const result =
    results.find(
      item =>
        item.id === id
    );

  if (!result) return;

  $("detailContent").innerHTML = `

    <div class="grid2">

      <div>
        <b>Student Name</b>
        <p>
          ${escapeHtml(
            result.name
          )}
        </p>
      </div>

      <div>
        <b>Email</b>
        <p>
          ${escapeHtml(
            result.email
          )}
        </p>
      </div>

      <div>
        <b>Exam</b>
        <p>
          ${escapeHtml(
            result.exam ||
            result.examTitle ||
            "-"
          )}
        </p>
      </div>

      <div>
        <b>Center</b>
        <p>
          ${escapeHtml(
            result.center ||
            result.centerCode ||
            "-"
          )}
        </p>
      </div>

      <div>
        <b>Score</b>
        <p>
          ${
            Number(result.score) || 0
          } /
          ${
            Number(result.total) || 0
          }
        </p>
      </div>

      <div>
        <b>Correct / Wrong</b>
        <p>
          ${
            Number(result.correct) || 0
          }
          /
          ${
            Number(result.wrong) || 0
          }
        </p>
      </div>

      <div>
        <b>Unanswered</b>
        <p>
          ${
            Number(
              result.unanswered
            ) || 0
          }
        </p>
      </div>

      <div>
        <b>Submitted</b>
        <p>
          ${formatDate(
            result.submittedAt
          )}
        </p>
      </div>

    </div>

    <hr>

    <p>
      <b>Rating:</b>
      ${
        result.rating
          ? escapeHtml(
              result.rating
            ) + "/5"
          : "-"
      }
    </p>

    <p>
      <b>Doubt:</b>
      ${
        escapeHtml(
          result.doubt
        ) || "-"
      }
    </p>

    <p>
      <b>Feedback:</b>
      ${
        escapeHtml(
          result.feedback
        ) || "-"
      }
    </p>

    <h3>Security Events</h3>

    ${
      Array.isArray(
        result.violations
      ) &&
      result.violations.length

        ? result.violations
            .map(
              event => `
                <p>
                  ${escapeHtml(
                    event.type
                  )}
                  —
                  ${escapeHtml(
                    event.message
                  )}
                  —
                  ${formatDate(
                    event.at
                  )}
                </p>
              `
            )
            .join("")

        : "<p>None</p>"
    }

  `;

  $("detailModal")
    .classList
    .remove("hidden");
}


$("closeModal").onclick =
  () =>
    $("detailModal")
      .classList
      .add("hidden");


$("detailModal").onclick =
  event => {

    if (
      event.target ===
      $("detailModal")
    ) {

      $("detailModal")
        .classList
        .add("hidden");
    }
  };


/* =========================================================
   SECURITY
========================================================= */

function renderSecurity() {

  let tabs = 0;
  let copies = 0;
  let penalty = 0;

  results.forEach(result => {

    tabs +=
      Number(
        result.tabSwitches
      ) || 0;

    copies +=
      Number(
        result.copiesAttempted
      ) || 0;

    penalty +=
      Number(
        result.penaltiesApplied
      ) || 0;
  });


  $("tabTotal").textContent =
    tabs;

  $("copyTotal").textContent =
    copies;

  $("penaltyTotal").textContent =
    penalty.toFixed(2);


  const flagged =
    results.filter(
      result =>
        Number(
          result.violationCount
        ) > 0
    );


  $("securityRows").innerHTML =
    flagged
      .map(result => `

        <tr>

          <td>
            ${escapeHtml(
              result.name
            )}
          </td>

          <td>
            ${escapeHtml(
              result.email
            )}
          </td>

          <td>
            ${
              Number(
                result.tabSwitches
              ) || 0
            }
          </td>

          <td>
            ${
              Number(
                result.copiesAttempted
              ) || 0
            }
          </td>

          <td>
            ${
              Number(
                result.violationCount
              ) || 0
            }
          </td>

          <td>
            ${
              Number(
                result.penaltiesApplied
              ) || 0
            }
          </td>

          <td>
            <span
              class="badge ${
                result.autoSubmitted
                  ? "bad"
                  : "good"
              }"
            >
              ${
                result.autoSubmitted
                  ? "Yes"
                  : "No"
              }
            </span>
          </td>

        </tr>

      `)
      .join("") ||

    `
      <tr>
        <td
          colspan="7"
          class="empty"
        >
          No security flags.
        </td>
      </tr>
    `;
}


/* =========================================================
   CSV
========================================================= */

$("csv").onclick = () => {

  const rows =
    filteredResults();

  if (!rows.length) {

    alert(
      "No results available."
    );

    return;
  }

  const header = [
    "Rank",
    "Name",
    "Email",
    "Exam",
    "Center",
    "Score",
    "Total",
    "Correct",
    "Wrong",
    "Unanswered",
    "Rating",
    "Violations",
    "Penalty",
    "Submitted At"
  ];

  const data =
    rows.map(
      (result, index) => [

        index + 1,

        result.name,

        result.email,

        result.exam ||
          result.examTitle ||
          "",

        result.center ||
          result.centerCode ||
          "",

        result.score,

        result.total,

        result.correct,

        result.wrong,

        result.unanswered,

        result.rating,

        result.violationCount,

        result.penaltiesApplied,

        formatDate(
          result.submittedAt
        )
      ]
    );


  const csv =
    "\ufeff" +
    [header, ...data]
      .map(row =>
        row
          .map(
            value =>
              `"${String(
                value ?? ""
              ).replaceAll(
                '"',
                '""'
              )}"`
          )
          .join(",")
      )
      .join("\n");


  const url =
    URL.createObjectURL(
      new Blob(
        [csv],
        {
          type:
            "text/csv;charset=utf-8"
        }
      )
    );


  const link =
    document.createElement(
      "a"
    );

  link.href = url;

  link.download =
    `TestHub-results-${
      new Date()
        .toISOString()
        .slice(0, 10)
    }.csv`;

  link.click();

  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    500
  );
};
