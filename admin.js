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
  getDocs,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";


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

let results = [];

let attempts = [];

let unsubs = [];

let logoData = "";

let config = {};


const ms = value => {

  if (value?.toMillis) {
    return value.toMillis();
  }

  if (value?.seconds) {
    return value.seconds * 1000;
  }

  if (typeof value === "number") {
    return value;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed)
    ? 0
    : parsed;

};


const fmt = value => {

  const timestamp = ms(value);

  return timestamp
    ? new Date(timestamp).toLocaleString("en-IN")
    : "-";

};


const local = value => {

  const timestamp = ms(value);

  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);

  const shifted = new Date(
    date -
    date.getTimezoneOffset() * 60000
  );

  return shifted
    .toISOString()
    .slice(0, 16);

};


const esc = value =>
  String(value ?? "")
    .replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character])
    );


const msg = (
  id,
  text,
  bad = false
) => {

  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent = text;

  element.className =
    `msg${bad ? " error" : " good"}`;

  element.classList.remove(
    "hidden"
  );

};


/* =========================================================
   ADMIN AUTHORIZATION
========================================================= */

async function isAdmin(user) {

  if (!user) {
    return false;
  }

  try {

    const snapshot = await getDoc(
      doc(
        db,
        "admin",
        user.uid
      )
    );

    const data =
      snapshot.data() || {};

    return (
      snapshot.exists() &&
      data.active === true &&
      [
        "admin",
        "super_admin"
      ].includes(
        data.role || "admin"
      )
    );

  } catch {

    return false;

  }

}


/* =========================================================
   LOGIN
========================================================= */

$("loginForm").onsubmit =
  async event => {

    event.preventDefault();

    $("loginBtn").disabled = true;

    try {

      await signInWithEmailAndPassword(
        auth,
        $("email")
          .value
          .trim()
          .toLowerCase(),
        $("password").value
      );

    } catch (error) {

      msg(
        "loginMsg",
        "Login failed: " +
        error.message,
        true
      );

    } finally {

      $("loginBtn").disabled =
        false;

    }

  };


$("logout").onclick =
  () =>
    signOut(auth);


$("refresh").onclick =
  async () => {

    await loadConfig();

    subscribe();

  };


/* =========================================================
   TABS
========================================================= */

document
  .querySelectorAll(".tab")
  .forEach(
    button => {

      button.onclick = () => {

        document
          .querySelectorAll(
            ".tab,.panel"
          )
          .forEach(
            element =>
              element.classList.remove(
                "active"
              )
          );

        button.classList.add(
          "active"
        );

        $(
          button.dataset.panel
        ).classList.add(
          "active"
        );

      };

    }
  );


/* =========================================================
   ACTIVE EXAMS
========================================================= */

document
  .querySelectorAll(
    ".active-exam"
  )
  .forEach(
    checkbox => {

      checkbox.onchange =
        () => {

          checkbox
            .closest(
              ".exam-pill"
            )
            ?.classList.toggle(
              "active",
              checkbox.checked
            );

          updateSummary();

        };

    }
  );


[
  "durationMinutes",
  "tabPenalty",
  "negativeMarking",
  "maxTabSwitches"
]
.forEach(
  id =>
    $(id)?.addEventListener(
      "input",
      updateSummary
    )
);


/* =========================================================
   SUMMARY
========================================================= */

function updateSummary() {

  const subjects =
    getSubjects();

  const active =
    [
      ...document.querySelectorAll(
        ".active-exam:checked"
      )
    ]
      .map(
        checkbox =>
          checkbox.value
            .replaceAll(
              "_",
              " "
            )
            .toUpperCase()
      );

  const total =
    subjects.reduce(
      (
        sum,
        subject
      ) =>
        sum + subject.count,
      0
    );

  const title =
    $("examSelect")
      .selectedOptions?.[0]
      ?.textContent ||
    "Exam";

  $("examSummary").innerHTML =
    `<b>${esc(title)}</b> · ` +
    `${subjects.length} subject(s) · ` +
    `${total} questions · ` +
    `Timer: ${
      Number(
        $("durationMinutes").value
      ) || 0
    } min · ` +
    `Penalty: ${
      Number(
        $("tabPenalty").value
      ) || 0
    }` +
    `<br><b>Active:</b> ` +
    `${
      active.length
        ? esc(active.join(", "))
        : "None"
    }`;

}


/* =========================================================
   SUBJECT
========================================================= */

function addSubject(
  data = {}
) {

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "subject-row";

  row.innerHTML = `

    <div>

      <label>
        Subject Name
      </label>

      <input
        class="s-name"
        value="${esc(
          data.name ||
          "All Questions"
        )}"
      >

    </div>


    <div>

      <label>
        Questions
      </label>

      <input
        class="s-count"
        type="number"
        min="1"
        value="${
          Number(
            data.count
          ) || 100
        }"
      >

    </div>


    <div>

      <label>
        Source
      </label>

      <input
        class="s-source"
        value="${esc(
          data.source ||
          "chapter.json"
        )}"
      >

    </div>


    <div>

      <label>
        Order
      </label>

      <select class="s-order">

        <option value="random">
          Random
        </option>

        <option value="sequential">
          Sequential
        </option>

      </select>

    </div>


    <button
      type="button"
      class="btn danger remove-subject"
    >
      🗑
    </button>

  `;


  row.querySelector(
    ".s-order"
  ).value =
    data.order ===
    "sequential"
      ? "sequential"
      : "random";


  row.querySelector(
    ".remove-subject"
  ).onclick =
    () => {

      row.remove();

      if (
        !$("subjectRows")
          .children
          .length
      ) {

        addSubject();

      }

      updateSummary();

    };


  row
    .querySelectorAll(
      "input,select"
    )
    .forEach(
      element =>
        element.addEventListener(
          "input",
          updateSummary
        )
    );


  $("subjectRows")
    .appendChild(row);

}


function getSubjects() {

  return [
    ...document.querySelectorAll(
      ".subject-row"
    )
  ]
    .map(
      row => ({

        name:
          row.querySelector(
            ".s-name"
          )
          .value
          .trim() ||
          "All Questions",

        count:
          Number(
            row.querySelector(
              ".s-count"
            ).value
          ) || 0,

        source:
          row.querySelector(
            ".s-source"
          )
          .value
          .trim() ||
          "chapter.json",

        order:
          row.querySelector(
            ".s-order"
          ).value

      })
    )
    .filter(
      subject =>
        subject.count > 0
    );

}


$("addSubject").onclick =
  () =>
    addSubject({
      name: "New Subject",
      count: 25,
      source: "chapter.json",
      order: "random"
    });


/* =========================================================
   LOAD CONFIG
========================================================= */

async function loadConfig() {

  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        )
      );


    config =
      snapshot.exists()
        ? snapshot.data()
        : {};


    $("examSelect").value =
      config.examId ||
      "rrb_group_d";


    $("durationMinutes").value =
      config.durationMinutes ??
      90;


    $("tabPenalty").value =
      config.tabPenalty ??
      0;


    $("negativeMarking").value =
      config.negativeMarking ??
      0;


    $("maxTabSwitches").value =
      config.maxTabSwitches ??
      5;


    $("centerCode").value =
      config.centerCode ??
      "";


    $("instituteName").value =
      config.instituteName ??
      "";


    $("instituteLocation").value =
      config.instituteLocation ??
      "";


    $("fullAddress").value =
      config.fullAddress ??
      "";


    $("windowStart").value =
      local(
        config.windowStart
      );


    $("windowEnd").value =
      local(
        config.windowEnd
      );


    $("examActive").value =
      String(
        config.examActive !== false
      );


    $("replaceQuestionOnSwitch").value =
      String(
        config.replaceQuestionOnSwitch !== false
      );


    logoData =
      config.instituteLogo ||
      "";


    if (logoData) {

      $("logoPreview").src =
        logoData;

      $("logoPreview")
        .classList
        .remove(
          "hidden"
        );

    }


    document
      .querySelectorAll(
        ".active-exam"
      )
      .forEach(
        checkbox => {

          checkbox.checked =
            (
              config.activeExams ||
              ["rrb_group_d"]
            )
              .includes(
                checkbox.value
              );

          checkbox
            .closest(
              ".exam-pill"
            )
            ?.classList.toggle(
              "active",
              checkbox.checked
            );

        }
      );


    document
      .querySelectorAll(
        'input[name="uploadMethod"]'
      )
      .forEach(
        radio => {

          radio.checked =
            radio.value ===
            (
              config.uploadMethod ||
              "live_form"
            );

        }
      );


    $("subjectRows")
      .innerHTML =
      "";


    const subjects =
      config.subjects?.length
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


    subjects.forEach(
      addSubject
    );


    updateSummary();


    $("adminTitle").textContent =
      `${
        config.instituteName?.trim() ||
        "TestHub"
      } Admin`;


  } catch (error) {

    msg(
      "subjectMsg",
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
      [
        ...document.querySelectorAll(
          ".active-exam:checked"
        )
      ]
        .map(
          checkbox =>
            checkbox.value
        );


    const total =
      subjects.reduce(
        (
          sum,
          subject
        ) =>
          sum +
          subject.count,
        0
      );


    if (!activeExams.length) {

      return msg(
        "subjectMsg",
        "Select at least one active exam.",
        true
      );

    }


    if (!subjects.length) {

      return msg(
        "subjectMsg",
        "Add at least one subject.",
        true
      );

    }


    const start =
      $("windowStart").value;

    const end =
      $("windowEnd").value;


    const windowStart =
      start
        ? new Date(start).getTime()
        : 0;


    const windowEnd =
      end
        ? new Date(end).getTime()
        : 0;


    if (
      windowStart &&
      windowEnd &&
      windowStart >= windowEnd
    ) {

      return msg(
        "subjectMsg",
        "Start time must be earlier than close time.",
        true
      );

    }


    try {

      const examId =
        $("examSelect").value;


      const examTitle =
        $("examSelect")
          .selectedOptions[0]
          .textContent;


      const payload = {

        examId,

        activeExams,

        subjects,

        totalPool:
          total,

        studentLimit:
          total,

        durationMinutes:
          Number(
            $("durationMinutes").value
          ) || 90,

        tabPenalty:
          Number(
            $("tabPenalty").value
          ) || 0,

        negativeMarking:
          Number(
            $("negativeMarking").value
          ) || 0,

        maxTabSwitches:
          Number(
            $("maxTabSwitches").value
          ) || 5,

        autoSubmitAfter:
          Number(
            $("maxTabSwitches").value
          ) || 5,

        replaceQuestionOnSwitch:
          $("replaceQuestionOnSwitch")
            .value !== "false",

        examActive:
          $("examActive")
            .value === "true",

        examTitle,

        questionSource:
          subjects[0].source,

        questionOrder:
          subjects[0].order,

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

        windowStart,

        windowEnd,

        uploadMethod:
          document.querySelector(
            'input[name="uploadMethod"]:checked'
          )?.value ||
          "live_form",

        updatedAt:
          serverTimestamp()

      };


      await setDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        ),
        payload,
        {
          merge:true
        }
      );


      await setDoc(
        doc(
          db,
          "exam_config",
          examId
        ),
        payload,
        {
          merge:true
        }
      );


      msg(
        "subjectMsg",
        "Exam and subject settings saved successfully."
      );


    } catch (error) {

      msg(
        "subjectMsg",
        "Save failed: " +
        error.message,
        true
      );

    }

  };


/* =========================================================
   CENTER
========================================================= */

$("activateCenter").onclick =
  async () => {

    try {

      const code =
        $("centerCode")
          .value
          .trim();


      if (!code) {

        return msg(
          "centerMsg",
          "Enter a center code first.",
          true
        );

      }


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
          merge:true
        }
      );


      msg(
        "centerMsg",
        `Active center code: ${code}`
      );


    } catch (error) {

      msg(
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

    try {

      const start =
        $("windowStart").value;

      const end =
        $("windowEnd").value;


      const windowStart =
        start
          ? new Date(start).getTime()
          : 0;


      const windowEnd =
        end
          ? new Date(end).getTime()
          : 0;


      if (
        windowStart &&
        windowEnd &&
        windowStart >= windowEnd
      ) {

        return msg(
          "availabilityMsg",
          "Start time must be earlier than close time.",
          true
        );

      }


      await setDoc(
        doc(
          db,
          "exam_config",
          "current_test"
        ),
        {

          windowStart,

          windowEnd,

          maxTabSwitches:
            Number(
              $("maxTabSwitches").value
            ) || 5,

          autoSubmitAfter:
            Number(
              $("maxTabSwitches").value
            ) || 5,

          examActive:
            $("examActive")
              .value === "true",

          uploadMethod:
            document.querySelector(
              'input[name="uploadMethod"]:checked'
            )?.value ||
            "live_form",

          updatedAt:
            serverTimestamp()

        },
        {
          merge:true
        }
      );


      msg(
        "availabilityMsg",
        "Availability settings saved successfully."
      );


    } catch (error) {

      msg(
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

    if (!file) {
      return;
    }


    if (
      file.size > 500000
    ) {

      alert(
        "Logo must be smaller than 500 KB."
      );

      event.target.value =
        "";

      return;

    }


    const reader =
      new FileReader();


    reader.onload =
      () => {

        logoData =
          reader.result;

        $("logoPreview").src =
          logoData;

        $("logoPreview")
          .classList
          .remove(
            "hidden"
          );

      };


    reader.readAsDataURL(
      file
    );

  };


$("instituteLogo").oninput =
  event => {

    logoData =
      event.target.value
        .trim();


    $("logoPreview")
      .classList.toggle(
        "hidden",
        !logoData
      );


    if (logoData) {

      $("logoPreview").src =
        logoData;

    }

  };


$("clearLogo").onclick =
  () => {

    logoData =
      "";

    $("instituteLogo").value =
      "";

    $("logoPreview").src =
      "";

    $("logoPreview")
      .classList
      .add(
        "hidden"
      );

  };


/* =========================================================
   SUBSCRIPTIONS
========================================================= */

function subscribe() {

  unsubs
    .splice(0)
    .forEach(
      unsubscribe =>
        unsubscribe()
    );


  /* LIVE ATTEMPTS */

  unsubs.push(

    onSnapshot(
      collection(
        db,
        "attempts"
      ),
      snapshot => {

        attempts =
          snapshot.docs.map(
            document => ({

              id:
                document.id,

              ...document.data()

            })
          );


        renderAttempts();

        renderStats();

      },
      error => {

        console.error(
          "Attempt listener:",
          error
        );

      }
    )

  );


  /* RESULTS */

  unsubs.push(

    onSnapshot(
      collection(
        db,
        "results"
      ),
      snapshot => {

        results =
          snapshot.docs.map(
            document => ({

              id:
                document.id,

              ...document.data()

            })
          );


        populateExamFilter();

        renderResults();

        renderSecurity();

        renderStats();

      },
      error => {

        console.error(
          "Results listener:",
          error
        );

      }
    )

  );

}


/* =========================================================
   STATS
========================================================= */

function renderStats() {

  $("submissions").textContent =
    results.length;


  $("active").textContent =
    attempts.filter(
      attempt =>
        attempt.status ===
        "in_progress"
    ).length;


  const average =
    results.length
      ? results.reduce(
          (
            sum,
            result
          ) =>
            sum +
            (
              Number(
                result.score
              ) || 0
            ),
          0
        ) /
        results.length
      : 0;


  $("average").textContent =
    average.toFixed(2);


  const rated =
    results.filter(
      result =>
        Number(
          result.rating
        ) > 0
    );


  const rating =
    rated.length
      ? rated.reduce(
          (
            sum,
            result
          ) =>
            sum +
            Number(
              result.rating
            ),
          0
        ) /
        rated.length
      : 0;


  $("ratingAvg").textContent =
    rating
      ? `${rating.toFixed(1)}/5`
      : "0/5";

}


/* =========================================================
   TIME FORMAT
========================================================= */

function formatRemaining(
  endsAt
) {

  const remaining =
    Math.max(
      0,
      ms(endsAt) -
      Date.now()
    );


  if (!remaining) {
    return "00:00";
  }


  const minutes =
    Math.floor(
      remaining /
      60000
    );


  const seconds =
    Math.floor(
      (
        remaining % 60000
      ) / 1000
    );


  return (
    `${String(
      minutes
    ).padStart(2,"0")}:` +
    `${String(
      seconds
    ).padStart(2,"0")}`
  );

}


/* =========================================================
   LIVE ATTEMPTS
========================================================= */

function renderAttempts() {

  const live =
    attempts
      .filter(
        attempt =>
          attempt.status !==
          "submitted"
      )
      .sort(
        (
          first,
          second
        ) =>
          ms(
            second.updatedAt
          ) -
          ms(
            first.updatedAt
          )
      );


  $("attemptRows").innerHTML =
    live
      .map(
        attempt => {

          const total =
            Number(
              attempt.questionIds?.length
            ) ||
            Number(
              attempt.totalQuestions
            ) ||
            0;


          const currentQuestion =
            Number(
              attempt.currentIndex
            ) || 0;


          const progress =
            total
              ? Math.min(
                  100,
                  (
                    (currentQuestion + 1) /
                    total
                  ) *
                  100
                )
              : 0;


          const forceRequested =
            attempt.forceSubmitRequested ===
            true;


          return `

            <tr>

              <td>

                <b>
                  ${esc(
                    attempt.name
                  )}
                </b>

              </td>


              <td>
                ${esc(
                  attempt.email
                )}
              </td>


              <td>
                ${esc(
                  attempt.examTitle ||
                  attempt.exam ||
                  "-"
                )}
              </td>


              <td>
                ${esc(
                  attempt.centerCode ||
                  "-"
                )}
              </td>


              <td>

                <span
                  class="badge ${
                    forceRequested
                      ? "amber"
                      : "good"
                  }"
                >
                  ${
                    forceRequested
                      ? "Submit requested"
                      : esc(
                          attempt.status ||
                          "active"
                        )
                  }
                </span>

              </td>


              <td>

                <div>
                  <b>
                    ${
                      total
                        ? `${Math.min(
                            currentQuestion + 1,
                            total
                          )}/${total}`
                        : "-"
                    }
                  </b>
                </div>

                <div class="progress">

                  <span
                    style="
                      width:${progress}%
                    "
                  ></span>

                </div>

              </td>


              <td>
                ${formatRemaining(
                  attempt.endsAt
                )}
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
                ${fmt(
                  attempt.updatedAt ||
                  attempt.startedAt
                )}
              </td>


              <td>

                <div
                  class="live-actions"
                >

                  ${
                    forceRequested

                      ? `
                        <span
                          class="badge amber"
                        >
                          Waiting...
                        </span>
                      `

                      : `
                        <button
                          type="button"
                          class="btn danger force-submit"
                          data-id="${esc(
                            attempt.id
                          )}"
                        >
                          Force Submit
                        </button>
                      `
                  }


                  <button
                    type="button"
                    class="btn light live-view"
                    data-id="${esc(
                      attempt.id
                    )}"
                  >
                    View
                  </button>

                </div>

              </td>

            </tr>

          `;

        }
      )
      .join("") ||

    `
      <tr>

        <td
          colspan="11"
          class="empty"
        >
          No active exam attempts.
        </td>

      </tr>
    `;


  document
    .querySelectorAll(
      ".force-submit"
    )
    .forEach(
      button =>
        button.onclick =
          () =>
            requestForceSubmit(
              button.dataset.id
            )
    );


  document
    .querySelectorAll(
      ".live-view"
    )
    .forEach(
      button =>
        button.onclick =
          () =>
            showLiveDetails(
              button.dataset.id
            )
    );

}


/* =========================================================
   FORCE SUBMIT REQUEST
========================================================= */

async function requestForceSubmit(
  id
) {

  const attempt =
    attempts.find(
      item =>
        item.id === id
    );


  if (!attempt) {
    return;
  }


  const studentName =
    attempt.name ||
    "this candidate";


  if (
    !confirm(
      `Force submit ${studentName}'s examination?\n\n` +
      `The student will be automatically submitted.`
    )
  ) {

    return;

  }


  try {

    await updateDocSafe(
      doc(
        db,
        "attempts",
        id
      ),
      {

        forceSubmitRequested:
          true,

        forceSubmitReason:
          "Submitted by administrator",

        forceSubmitRequestedAt:
          serverTimestamp(),

        forceSubmitRequestedBy:
          currentUser?.uid ||
          "",

        updatedAt:
          serverTimestamp()

      }
    );


    alert(
      "Force-submit request sent to the student panel."
    );


  } catch (error) {

    alert(
      "Force submit failed:\n" +
      error.message
    );

  }

}


/*
   Small wrapper kept separate to make
   admin action failures easier to diagnose.
*/

async function updateDocSafe(
  reference,
  data
) {

  const module =
    await import(
      "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js"
    );


  await module.updateDoc(
    reference,
    data
  );

}


/* =========================================================
   LIVE DETAILS
========================================================= */

function showLiveDetails(
  id
) {

  const attempt =
    attempts.find(
      item =>
        item.id === id
    );


  if (!attempt) {
    return;
  }


  $("detailTitle").textContent =
    `${attempt.name || "Candidate"} — Live Attempt`;


  $("detailSubtitle").textContent =
    `${attempt.examTitle || attempt.exam || "-"} · ${
      attempt.email || "-"
    }`;


  $("detailContent").innerHTML = `

    <div class="detail-grid">

      <div class="detail-box">

        <span>
          Status
        </span>

        <strong>
          ${esc(
            attempt.status ||
            "active"
          )}
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Current Question
        </span>

        <strong>
          ${
            Number(
              attempt.currentIndex
            ) + 1
          }
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Total Questions
        </span>

        <strong>
          ${
            attempt.questionIds?.length ||
            "-"
          }
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Time Left
        </span>

        <strong>
          ${formatRemaining(
            attempt.endsAt
          )}
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Violations
        </span>

        <strong>
          ${
            Number(
              attempt.violationCount
            ) || 0
          }
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Penalty
        </span>

        <strong>
          ${
            Number(
              attempt.penaltiesApplied
            ) || 0
          }
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Started
        </span>

        <strong>
          ${fmt(
            attempt.startedAt
          )}
        </strong>

      </div>


      <div class="detail-box">

        <span>
          Last Activity
        </span>

        <strong>
          ${fmt(
            attempt.updatedAt
          )}
        </strong>

      </div>

    </div>


    <div class="summary">

      <b>
        Center:
      </b>

      ${esc(
        attempt.centerCode ||
        "-"
      )}

      <br>

      <b>
        Force Submit:
      </b>

      ${
        attempt.forceSubmitRequested
          ? "Requested"
          : "Not requested"
      }

    </div>


    <div class="section-block">

      <h3>
        Security Events
      </h3>

      ${
        Array.isArray(
          attempt.violations
        ) &&
        attempt.violations.length

          ? attempt.violations
              .map(
                event => `

                  <div class="event">

                    <b>
                      ${esc(
                        event.type ||
                        "security-event"
                      )}
                    </b>

                    <br>

                    ${esc(
                      event.message ||
                      ""
                    )}

                    <br>

                    <span class="muted">
                      ${fmt(
                        event.at
                      )}
                    </span>

                  </div>

                `
              )
              .join("")

          : `
              <p class="muted">
                No security events.
              </p>
            `
      }

    </div>

  `;


  $("detailModal")
    .classList
    .remove(
      "hidden"
    );

}


/* =========================================================
   EXAM FILTER
========================================================= */

function populateExamFilter() {

  const select =
    $("examFilter");


  const selected =
    select.value;


  const map =
    new Map();


  results.forEach(
    result => {

      const id =
        String(
          result.examId ||
          result.exam ||
          result.examTitle ||
          "unknown"
        );


      const title =
        String(
          result.examTitle ||
          result.exam ||
          result.examId ||
          "Unknown Exam"
        );


      map.set(
        id,
        title
      );

    }
  );


  select.innerHTML =
    `
      <option value="">
        All Exams
      </option>
    `;


  [
    ...map.entries()
  ]
    .sort(
      (
        first,
        second
      ) =>
        first[1]
          .localeCompare(
            second[1]
          )
    )
    .forEach(
      (
        [
          id,
          title
        ]
      ) => {

        const option =
          document.createElement(
            "option"
          );

        option.value =
          id;

        option.textContent =
          title;

        select.appendChild(
          option
        );

      }
    );


  select.value =
    selected;

}


/* =========================================================
   FILTERED RESULTS
========================================================= */

function getFilteredResults() {

  const query =
    $("resultSearch")
      .value
      .trim()
      .toLowerCase();


  const exam =
    $("examFilter")
      .value;


  const sort =
    $("resultSort")
      .value;


  const filtered =
    results.filter(
      result => {

        const text =
          [
            result.name,
            result.email,
            result.exam,
            result.examTitle,
            result.center,
            result.centerCode
          ]
            .join(" ")
            .toLowerCase();


        const resultExam =
          String(
            result.examId ||
            result.exam ||
            result.examTitle ||
            "unknown"
          );


        return (
          (!query ||
            text.includes(query)) &&
          (!exam ||
            resultExam === exam)
        );

      }
    );


  filtered.sort(
    (
      first,
      second
    ) => {

      if (
        sort ===
        "newest"
      ) {

        return (
          ms(
            second.submittedAt
          ) -
          ms(
            first.submittedAt
          )
        );

      }


      if (
        sort ===
        "rating"
      ) {

        return (
          (
            Number(
              second.rating
            ) || 0
          ) -
          (
            Number(
              first.rating
            ) || 0
          )
        );

      }


      const score =
        (
          Number(
            second.score
          ) || 0
        ) -
        (
          Number(
            first.score
          ) || 0
        );


      if (score !== 0) {
        return score;
      }


      return (
        ms(
          first.submittedAt
        ) -
        ms(
          second.submittedAt
        )
      );

    }
  );


  return filtered;

}


/* =========================================================
   RENDER RESULTS
========================================================= */

function renderResults() {

  const filtered =
    getFilteredResults();


  $("filteredCount").textContent =
    filtered.length;


  const highest =
    filtered.length
      ? Math.max(
          ...filtered.map(
            result =>
              Number(
                result.score
              ) || 0
          )
        )
      : 0;


  $("highestScore").textContent =
    highest;


  const average =
    filtered.length
      ? filtered.reduce(
          (
            sum,
            result
          ) =>
            sum +
            (
              Number(
                result.score
              ) || 0
            ),
          0
        ) /
        filtered.length
      : 0;


  $("filteredAverage").textContent =
    average.toFixed(2);


  $("filteredFlags").textContent =
    filtered.filter(
      result =>
        Number(
          result.violationCount
        ) > 0
    ).length;


  $("resultRows").innerHTML =
    filtered
      .map(
        (
          result,
          index
        ) => `

          <tr>

            <td>

              <span
                class="badge blue"
              >
                #${index + 1}
              </span>

            </td>


            <td>

              <b>
                ${esc(
                  result.name
                )}
              </b>

              <br>

              <span
                class="muted"
              >
                ${esc(
                  result.email
                )}
              </span>

            </td>


            <td>
              ${esc(
                result.examTitle ||
                result.exam ||
                "-"
              )}
            </td>


            <td>
              ${esc(
                result.center ||
                result.centerCode ||
                "-"
              )}
            </td>


            <td>

              <span
                class="badge blue"
              >
                ${
                  Number(
                    result.score
                  ) || 0
                }/${
                  Number(
                    result.total
                  ) || 0
                }
              </span>

            </td>


            <td>
              ${
                Number(
                  result.correct
                ) || 0
              }
            </td>


            <td>
              ${
                Number(
                  result.wrong
                ) || 0
              }
            </td>


            <td>
              ${
                (
                  Number(
                    result.correct
                  ) || 0
                ) +
                (
                  Number(
                    result.wrong
                  ) || 0
                )
              }
            </td>


            <td>
              ${fmt(
                result.submittedAt
              )}
            </td>


            <td>
              ${
                result.rating
                  ? `${esc(
                      result.rating
                    )}/5`
                  : "-"
              }
            </td>


            <td>

              <button
                type="button"
                class="btn light view"
                data-id="${esc(
                  result.id
                )}"
              >
                View
              </button>


              <button
                type="button"
                class="btn danger del"
                data-id="${esc(
                  result.id
                )}"
              >
                Delete
              </button>

            </td>

          </tr>

        `
      )
      .join("") ||

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
    .querySelectorAll(
      ".view"
    )
    .forEach(
      button =>
        button.onclick =
          () =>
            showResultDetails(
              button.dataset.id
            )
    );


  document
    .querySelectorAll(
      ".del"
    )
    .forEach(
      button =>
        button.onclick =
          () =>
            deleteResult(
              button.dataset.id
            )
    );

}


/* =========================================================
   RESULT DETAILS
========================================================= */

function showResultDetails(
  id
) {

  const result =
    results.find(
      item =>
        item.id === id
    );


  if (!result) {
    return;
  }


  $("detailTitle").textContent =
    `${result.name || "Candidate"} — Result`;


  $("detailSubtitle").textContent =
    `${result.examTitle || result.exam || "-"} · ${
      result.email || "-"
    }`;


  $("detailContent").innerHTML = `

    <div class="detail-grid">

      <div class="detail-box">
        <span>Score</span>
        <strong>
          ${
            Number(
              result.score
            ) || 0
          }/${
            Number(
              result.total
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Correct</span>
        <strong>
          ${
            Number(
              result.correct
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Wrong</span>
        <strong>
          ${
            Number(
              result.wrong
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Unanswered</span>
        <strong>
          ${
            Number(
              result.unanswered
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Violations</span>
        <strong>
          ${
            Number(
              result.violationCount
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Penalty</span>
        <strong>
          ${
            Number(
              result.penaltiesApplied
            ) || 0
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Time Taken</span>
        <strong>
          ${
            result.timeTakenSeconds
              ? formatDuration(
                  result.timeTakenSeconds
                )
              : "-"
          }
        </strong>
      </div>


      <div class="detail-box">
        <span>Submitted</span>
        <strong>
          ${fmt(
            result.submittedAt
          )}
        </strong>
      </div>

    </div>


    <div class="summary">

      <b>Center:</b>
      ${esc(
        result.centerCode ||
        result.center ||
        "-"
      )}

      <br>

      <b>Auto Submitted:</b>
      ${
        result.autoSubmitted
          ? "Yes"
          : "No"
      }

      <br>

      <b>Rating:</b>
      ${
        result.rating
          ? `${esc(
              result.rating
            )}/5`
          : "-"
      }

      <br>

      <b>Doubt:</b>
      ${
        esc(
          result.doubt
        ) || "-"
      }

      <br>

      <b>Feedback:</b>
      ${
        esc(
          result.feedback
        ) || "-"
      }

    </div>


    <h3>
      Security Events
    </h3>

    ${
      Array.isArray(
        result.violations
      ) &&
      result.violations.length

        ? result.violations
            .map(
              event => `

                <div class="event">

                  <b>
                    ${esc(
                      event.type ||
                      "security-event"
                    )}
                  </b>

                  <br>

                  ${esc(
                    event.message ||
                    ""
                  )}

                  <br>

                  <span class="muted">
                    ${fmt(
                      event.at
                    )}
                  </span>

                </div>

              `
            )
            .join("")

        : `
            <p class="muted">
              No security events.
            </p>
          `
    }

  `;


  $("detailModal")
    .classList
    .remove(
      "hidden"
    );

}


function formatDuration(
  seconds
) {

  const value =
    Math.max(
      0,
      Number(seconds) || 0
    );


  const minutes =
    Math.floor(
      value /
      60
    );


  const remaining =
    value % 60;


  return (
    `${minutes}m ` +
    `${String(
      remaining
    ).padStart(
      2,
      "0"
    )}s`
  );

}


/* =========================================================
   DELETE
========================================================= */

async function deleteResult(
  id
) {

  if (
    !confirm(
      "Delete this result and its exam attempt?"
    )
  ) {

    return;

  }


  try {

    await deleteDoc(
      doc(
        db,
        "results",
        id
      )
    );


    await deleteDoc(
      doc(
        db,
        "attempts",
        id
      )
    )
    .catch(
      () => {}
    );


  } catch (error) {

    alert(
      "Delete failed: " +
      error.message
    );

  }

}


/* =========================================================
   MODAL
========================================================= */

$("closeModal").onclick =
  () =>
    $("detailModal")
      .classList
      .add(
        "hidden"
      );


$("detailModal").onclick =
  event => {

    if (
      event.target ===
      $("detailModal")
    ) {

      $("detailModal")
        .classList
        .add(
          "hidden"
        );

    }

  };


/* =========================================================
   SECURITY
========================================================= */

function renderSecurity() {

  let tabs = 0;

  let copies = 0;

  let penalties = 0;


  results.forEach(
    result => {

      tabs +=
        Number(
          result.tabSwitches
        ) || 0;


      copies +=
        Number(
          result.copiesAttempted
        ) || 0;


      penalties +=
        Number(
          result.penaltiesApplied
        ) || 0;

    }
  );


  const flagged =
    results.filter(
      result =>
        Number(
          result.violationCount
        ) > 0
    );


  $("violations").textContent =
    flagged.length;


  $("tabTotal").textContent =
    tabs;


  $("copyTotal").textContent =
    copies;


  $("penaltyTotal").textContent =
    penalties.toFixed(2);


  $("securityRows").innerHTML =
    flagged
      .map(
        result => `

          <tr>

            <td>
              ${esc(
                result.name
              )}
            </td>

            <td>
              ${esc(
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

        `
      )
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
   RESULT SEARCH
========================================================= */

$("resultSearch").oninput =
  renderResults;


$("examFilter").onchange =
  renderResults;


$("resultSort").onchange =
  renderResults;


/* =========================================================
   CSV
========================================================= */

function csvCell(
  value
) {

  return `"${String(
    value ?? ""
  ).replaceAll(
    '"',
    '""'
  )}"`;

}


$("csv").onclick =
  () => {

    const rows =
      getFilteredResults();


    if (!rows.length) {

      return alert(
        "No results available."
      );

    }


    const output = [[

      "Rank",
      "Name",
      "Email",
      "Exam ID",
      "Exam",
      "Center",
      "Score",
      "Total",
      "Correct",
      "Wrong",
      "Unanswered",
      "Attempted",
      "Rating",
      "Violations",
      "Penalty",
      "Auto Submitted",
      "Time Taken",
      "Submitted"

    ]];


    rows.forEach(
      (
        result,
        index
      ) => {

        output.push([

          index + 1,

          result.name,

          result.email,

          result.examId,

          result.examTitle ||
            result.exam ||
            "",

          result.centerCode ||
            result.center ||
            "",

          result.score,

          result.total,

          result.correct,

          result.wrong,

          result.unanswered,

          (
            Number(
              result.correct
            ) || 0
          ) +
          (
            Number(
              result.wrong
            ) || 0
          ),

          result.rating,

          result.violationCount,

          result.penaltiesApplied,

          result.autoSubmitted
            ? "Yes"
            : "No",

          result.timeTakenSeconds
            ? formatDuration(
                result.timeTakenSeconds
              )
            : "",

          fmt(
            result.submittedAt
          )

        ]);

      }
    );


    const csv =
      "\ufeff" +
      output
        .map(
          row =>
            row
              .map(csvCell)
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


    const anchor =
      document.createElement(
        "a"
      );


    anchor.href =
      url;


    anchor.download =
      `TestHub-live-results-${
        new Date()
          .toISOString()
          .slice(
            0,
            10
          )
      }.csv`;


    document.body.appendChild(
      anchor
    );


    anchor.click();

    anchor.remove();


    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      500
    );

  };


/* =========================================================
   CLEAR
========================================================= */

async function deleteBatch(
  docs
) {

  for (
    let i = 0;
    i < docs.length;
    i += 400
  ) {

    const batch =
      writeBatch(db);


    docs
      .slice(
        i,
        i + 400
      )
      .forEach(
        document =>
          batch.delete(
            document.ref
          )
      );


    await batch.commit();

  }

}


$("clearResults").onclick =
  async () => {

    if (!results.length) {

      return alert(
        "There are no results."
      );

    }


    if (
      !confirm(
        "Delete all results and submitted attempts?"
      )
    ) {

      return;

    }


    try {

      const [
        resultSnapshot,
        attemptSnapshot
      ] =
        await Promise.all([

          getDocs(
            collection(
              db,
              "results"
            )
          ),

          getDocs(
            collection(
              db,
              "attempts"
            )
          )

        ]);


      await deleteBatch(
        resultSnapshot.docs
      );


      await deleteBatch(
        attemptSnapshot.docs.filter(
          document =>
            document.data().status ===
            "submitted"
        )
      );


    } catch (error) {

      alert(
        "Clear failed: " +
        error.message
      );

    }

  };


/* =========================================================
   AUTH STATE
========================================================= */

onAuthStateChanged(
  auth,
  async user => {

    unsubs
      .splice(0)
      .forEach(
        unsubscribe =>
          unsubscribe()
      );


    if (!user) {

      currentUser =
        null;

      $("login")
        .classList
        .remove(
          "hidden"
        );

      $("app")
        .classList
        .add(
          "hidden"
        );

      return;

    }


    if (
      !(await isAdmin(user))
    ) {

      msg(
        "loginMsg",
        "This Firebase account is not authorized in admin/{uid}.",
        true
      );


      await signOut(
        auth
      );


      return;

    }


    currentUser =
      user;


    $("login")
      .classList
      .add(
        "hidden"
      );


    $("app")
      .classList
      .remove(
        "hidden"
      );


    $("adminLabel").textContent =
      user.email ||
      user.uid;


    await loadConfig();

    subscribe();

  }
);


/* =========================================================
   DEFAULT SUBJECT
========================================================= */

addSubject({

  name:
    "All Questions",

  count:
    100,

  source:
    "chapter.json",

  order:
    "random"

});


document
  .querySelectorAll(
    ".active-exam"
  )
  .forEach(
    checkbox =>
      checkbox
        .closest(
          ".exam-pill"
        )
        ?.classList.toggle(
          "active",
          checkbox.checked
        )
  );


updateSummary();


/* LIVE CLOCK REFRESH */

setInterval(
  renderAttempts,
  1000
);
