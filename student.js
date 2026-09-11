import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import {
  SecurityMonitor
} from "./security.js";


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

const app =
  initializeApp(firebaseConfig);

const auth =
  getAuth(app);

const db =
  getFirestore(app);

const $ =
  id =>
    document.getElementById(id);


/* =========================================================
   STATE
========================================================= */

let config;

let questions = [];

let pool = [];

let attempt;

let attemptId = "";

let current = 0;

let timerHandle;

let monitor;

let submitting = false;

let pendingCandidate;

let rating = 0;


/*
  Security startup protection.
  First fullscreen initialization is NOT a violation.
*/

let securityReady = false;

let securityGraceUntil = 0;


/* =========================================================
   HELPERS
========================================================= */

const normalizeEmail =
  value =>
    value
      .trim()
      .toLowerCase();


const asMillis =
  value =>
    value?.toMillis
      ? value.toMillis()
      : value?.seconds
        ? value.seconds * 1000
        : typeof value === "number"
          ? value
          : Date.parse(value) || 0;


const shuffle =
  array => {

    const copy =
      [...array];

    for (
      let i =
        copy.length - 1;
      i > 0;
      i--
    ) {

      const j =
        Math.floor(
          Math.random() * (i + 1)
        );

      [
        copy[i],
        copy[j]
      ] = [
        copy[j],
        copy[i]
      ];
    }

    return copy;
  };


async function hash(value) {

  const buffer =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        value
      )
    );

  return [
    ...new Uint8Array(
      buffer
    )
  ]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   MESSAGE
========================================================= */

function message(
  text,
  error = false
) {

  $("loginMessage")
    .textContent =
      text;

  $("loginMessage")
    .className =
      `notice${
        error
          ? " error"
          : ""
      }`;

  $("loginMessage")
    .classList
    .remove("hidden");
}


/* =========================================================
   BRAND
========================================================= */

function applyBrand() {

  const name =
    config
      .instituteName
      ?.trim() ||
    "TestHub";

  $("instituteName")
    .textContent =
      name;

  document.title =
    `${name} | Secure Examination`;


  if (config.instituteLogo) {

    $("loginLogo")
      .src =
        config.instituteLogo;

    $("loginLogo")
      .classList
      .remove("hidden");

    $("loginFallback")
      .classList
      .add("hidden");
  }
}


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

    if (!snapshot.exists()) {

      throw new Error(
        "The exam is not configured yet."
      );
    }

    config =
      snapshot.data();

    applyBrand();

    const now =
      Date.now();

    const start =
      asMillis(
        config.windowStart
      );

    const end =
      asMillis(
        config.windowEnd
      );


    if (
      config.examActive === false
    ) {

      throw new Error(
        "The exam is currently closed."
      );
    }


    if (
      start &&
      now < start
    ) {

      throw new Error(
        `The exam will start on ${
          new Date(start)
            .toLocaleString("en-IN")
        }.`
      );
    }


    if (
      end &&
      now > end
    ) {

      throw new Error(
        "The exam window has ended."
      );
    }


    $("examInfo")
      .textContent =
        `${
          config.examTitle ||
          "TestHub Examination"
        } · ${
          config.durationMinutes ||
          30
        } minutes · ${
          config.studentLimit ||
          10
        } questions`;


    $("continueBtn")
      .disabled = false;

  } catch (error) {

    $("examInfo")
      .textContent =
        error.message;

    $("examInfo")
      .classList
      .add("error");
  }
}


/* =========================================================
   AUTH
========================================================= */

onAuthStateChanged(
  auth,
  user => {

    if (user) {

      loadConfig();

      return;
    }

    signInAnonymously(auth)
      .catch(error => {

        $("examInfo")
          .textContent =
            "Enable Firebase Anonymous Authentication: " +
            error.message;

        $("examInfo")
          .classList
          .add("error");
      });

  }
);


/* =========================================================
   CANDIDATE LOGIN
========================================================= */

$("candidateForm").onsubmit =
  event => {

    event.preventDefault();

    const name =
      $("candidateName")
        .value
        .trim();

    const email =
      normalizeEmail(
        $("candidateEmail")
          .value
      );

    const centerCode =
      $("centerCode")
        .value
        .trim();


    if (!name || !email) {

      return message(
        "Full name and email are required.",
        true
      );
    }


    if (
      config.centerCode &&
      centerCode !==
        String(
          config.centerCode
        )
    ) {

      return message(
        "The Exam Center Code is incorrect.",
        true
      );
    }


    pendingCandidate = {
      name,
      email
    };


    $("configSummary")
      .innerHTML = `

        <div>
          <b>
            ${
              config.durationMinutes ||
              30
            }
          </b>
          <br>
          Minutes
        </div>

        <div>
          <b>
            ${
              config.studentLimit ||
              10
            }
          </b>
          <br>
          Questions
        </div>

        <div>
          <b>
            ${
              config.negativeMarking ||
              0
            }
          </b>
          <br>
          Negative
        </div>

        <div>
          <b>
            ${
              config.maxTabSwitches ||
              config.autoSubmitAfter ||
              3
            }
          </b>
          <br>
          Violations
        </div>

      `;


    $("loginView")
      .classList
      .add("hidden");

    $("instructionsView")
      .classList
      .remove("hidden");
  };


/* =========================================================
   INSTRUCTIONS
========================================================= */

$("backBtn").onclick =
  () => {

    $("instructionsView")
      .classList
      .add("hidden");

    $("loginView")
      .classList
      .remove("hidden");
  };


$("consent").onchange =
  () => {

    $("startBtn").disabled =
      !$("consent").checked;
  };


$("startBtn").onclick =
  prepareExam;


/* =========================================================
   QUESTION VALIDATION
========================================================= */

function validate(
  bank
) {

  if (!Array.isArray(bank)) {

    throw new Error(
      "The question bank format is invalid."
    );
  }


  for (const question of bank) {

    if (
      question.id == null ||
      !(question.q || question.question) ||
      !Array.isArray(
        question.options
      ) ||
      question.options.length < 2 ||
      !question.options.includes(
        question.a ??
        question.answer
      )
    ) {

      throw new Error(
        `Question ${
          question.id ??
          "?"
        } is invalid.`
      );
    }
  }
}


/* =========================================================
   QUESTION FILE
========================================================= */

async function getPool() {

  const response =
    await fetch(
      "./chapter.json",
      {
        cache:
          "no-store"
      }
    );


  if (!response.ok) {

    throw new Error(
      "The question file could not be loaded."
    );
  }


  pool =
    await response.json();

  validate(pool);

  return pool;
}


/* =========================================================
   PREPARE EXAM
========================================================= */

async function prepareExam() {

  const button =
    $("startBtn");

  button.disabled = true;


  try {

    if (!auth.currentUser) {

      await signInAnonymously(
        auth
      );
    }


    attemptId =
      await hash(
        pendingCandidate.email
      );


    const attemptRef =
      doc(
        db,
        "attempts",
        attemptId
      );


    const existing =
      await getDoc(
        attemptRef
      );


    await getPool();


    if (existing.exists()) {

      attempt =
        existing.data();


      if (
        attempt.ownerUid !==
        auth.currentUser.uid
      ) {

        throw new Error(
          "An exam attempt already exists for this email."
        );
      }


      if (
        attempt.status ===
        "submitted"
      ) {

        throw new Error(
          "This email has already submitted the exam."
        );
      }


      const questionMap =
        new Map(
          pool.map(
            question => [
              String(question.id),
              question
            ]
          )
        );


      questions =
        attempt.questionIds
          .map(
            id =>
              questionMap.get(
                String(id)
              )
          )
          .filter(Boolean);


      if (
        questions.length !==
        attempt.questionIds.length
      ) {

        throw new Error(
          "Some saved questions are no longer available."
        );
      }


      current =
        Number(
          attempt.currentIndex ||
          0
        );


      startExam(true);

      return;
    }


    questions =
      shuffle(pool)
        .slice(
          0,
          Math.min(
            Number(
              config.studentLimit
            ) ||
            pool.length,
            pool.length
          )
        );


    if (!questions.length) {

      throw new Error(
        "The question bank is empty."
      );
    }


    const startedAt =
      Date.now();


    attempt = {

      ownerUid:
        auth.currentUser.uid,

      ...pendingCandidate,

      status:
        "in_progress",

      startedAt,

      endsAt:
        startedAt +
        (
          Number(
            config.durationMinutes
          ) ||
          30
        ) *
        60000,

      currentIndex:
        0,

      questionIds:
        questions.map(
          question =>
            question.id
        ),

      answers:
        {},

      review:
        [],

      violations:
        [],

      violationCount:
        0,

      penaltiesApplied:
        0

    };


    await setDoc(
      attemptRef,
      {
        ...attempt,
        updatedAt:
          serverTimestamp()
      }
    );


    startExam(false);


  } catch (error) {

    message(
      error.message,
      true
    );

    $("instructionsView")
      .classList
      .add("hidden");

    $("loginView")
      .classList
      .remove("hidden");

    button.disabled =
      false;
  }
}


/* =========================================================
   START EXAM
========================================================= */

async function startExam(
  resumed
) {

  $("instructionsView")
    .classList
    .add("hidden");

  $("examView")
    .classList
    .remove("hidden");


  $("examTitle")
    .textContent =
      config.examTitle ||
      "TestHub Examination";


  $("candidateLabel")
    .textContent =
      `${attempt.name} · ${attempt.email}`;


  render();

  startTimer();


  /*
    IMPORTANT FIX:
    SecurityMonitor is not started before fullscreen initialization.
    We also ignore events during first 4 seconds.
  */

  securityReady =
    false;

  securityGraceUntil =
    Date.now() + 4000;


  monitor =
    new SecurityMonitor({

      autoSubmitAfter:
        Number(
          config.maxTabSwitches ||
          config.autoSubmitAfter
        ) || 3,

      onViolation:
        violation,

      onForceSubmit:
        () =>
          submitExam(true)

    });


  /*
    First request fullscreen.
    Only AFTER the request is finished do we start monitoring.
  */

  try {

    await monitor.requestFullscreen();

  } catch (error) {

    console.warn(
      "Fullscreen request:",
      error
    );
  }


  monitor.start();


  /*
    During these first 4 seconds:
    no security violation is counted.
  */

  setTimeout(
    () => {

      securityReady =
        true;

      securityGraceUntil =
        0;

    },
    4000
  );


  if (resumed) {

    await sync({
      lastResumedAt:
        serverTimestamp()
    });
  }
}


/* =========================================================
   RENDER QUESTION
========================================================= */

function render() {

  const question =
    questions[current];


  if (!question) return;


  const text =
    question.q ??
    question.question;


  $("questionNumber")
    .textContent =
      `Question ${
        current + 1
      }/${
        questions.length
      }`;


  $("questionText")
    .textContent =
      text;


  const image =
    question.image ||
    question.imageUrl;


  $("questionImage")
    .classList
    .toggle(
      "hidden",
      !image
    );


  if (image) {

    $("questionImage")
      .src =
        image;
  }


  $("options")
    .innerHTML = "";


  question.options.forEach(
    (option, index) => {

      const label =
        document.createElement(
          "label"
        );

      const radio =
        document.createElement(
          "input"
        );

      const span =
        document.createElement(
          "span"
        );


      label.className =
        "option";


      radio.type =
        "radio";

      radio.name =
        "answer";

      radio.value =
        option;

      radio.checked =
        attempt.answers?.[
          question.id
        ] === option;


      span.textContent =
        `${
          String.fromCharCode(
            65 + index
          )
        }. ${option}`;


      label.append(
        radio,
        span
      );


      $("options")
        .append(label);
    }
  );


  $("palette")
    .innerHTML = "";


  questions.forEach(
    (item, index) => {

      const button =
        document.createElement(
          "button"
        );


      button.className =
        `
          qbtn
          ${
            index === current
              ? " current"
              : ""
          }
          ${
            attempt.answers?.[
              item.id
            ]
              ? " answered"
              : ""
          }
          ${
            attempt.review?.includes(
              item.id
            )
              ? " review"
              : ""
          }
        `;


      button.textContent =
        index + 1;


      button.onclick =
        () => {

          save();

          current =
            index;

          sync();

          render();
        };


      $("palette")
        .append(button);
    }
  );


  $("prevBtn")
    .disabled =
      !current;


  $("securityCount")
    .textContent =
      `Violations: ${
        attempt.violationCount ||
        0
      }`;


  $("penaltyCount")
    .textContent =
      `Penalty: ${
        attempt.penaltiesApplied ||
        0
      }`;
}


/* =========================================================
   SAVE ANSWER
========================================================= */

function save() {

  const selected =
    document.querySelector(
      'input[name="answer"]:checked'
    );


  if (!selected) return;


  attempt.answers[
    String(
      questions[current].id
    )
  ] =
    selected.value;
}


/* =========================================================
   FIRESTORE SYNC
========================================================= */

async function sync(
  extra = {}
) {

  Object.assign(
    attempt,
    extra,
    {
      currentIndex:
        current
    }
  );


  try {

    await updateDoc(
      doc(
        db,
        "attempts",
        attemptId
      ),
      {

        answers:
          attempt.answers,

        review:
          attempt.review,

        currentIndex:
          current,

        violations:
          attempt.violations,

        violationCount:
          attempt.violationCount,

        penaltiesApplied:
          attempt.penaltiesApplied,

        ...extra,

        updatedAt:
          serverTimestamp()

      }
    );

  } catch (error) {

    console.error(
      "Sync failed:",
      error
    );
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

$("prevBtn").onclick =
  () => {

    save();

    current =
      Math.max(
        0,
        current - 1
      );

    sync();

    render();
  };


$("saveNextBtn").onclick =
  () => {

    save();

    current =
      Math.min(
        questions.length - 1,
        current + 1
      );

    sync();

    render();
  };


$("reviewBtn").onclick =
  () => {

    save();

    const id =
      questions[current].id;

    const position =
      attempt.review.indexOf(
        id
      );


    if (position < 0) {

      attempt.review.push(
        id
      );

    } else {

      attempt.review.splice(
        position,
        1
      );
    }


    sync();

    render();
  };


$("submitBtn").onclick =
  () => {

    const confirmed =
      confirm(
        "Do you want to submit the exam now?"
      );

    if (!confirmed) return;

    submitExam(false);
  };


/* =========================================================
   SECURITY ALERT
========================================================= */

function alertSecurity(
  text
) {

  $("securityAlert")
    .textContent =
      text;

  $("securityAlert")
    .classList
    .remove("hidden");


  setTimeout(
    () =>
      $("securityAlert")
        .classList
        .add("hidden"),
    3500
  );
}


/* =========================================================
   SECURITY VIOLATION
========================================================= */

async function violation(
  event
) {

  if (submitting) return;


  /*
    FALSE FIRST PENALTY FIX

    Ignore:
    - fullscreen startup
    - browser permission transition
    - initial blur
    - initial tab visibility event

    for the first 4 seconds.
  */

  if (
    !securityReady ||
    Date.now() <
      securityGraceUntil
  ) {

    console.log(
      "Ignored startup security event:",
      event?.type
    );

    return;
  }


  attempt.violationCount =
    (
      attempt.violationCount ||
      0
    ) + 1;


  const penalty =
    Number(
      config.tabPenalty
    ) || 0;


  attempt.penaltiesApplied =
    Number(
      (
        (
          attempt.penaltiesApplied ||
          0
        ) +
        penalty
      ).toFixed(2)
    );


  attempt.violations.push({

    type:
      event?.type ||
      "security-event",

    message:
      event?.message ||
      "",

    at:
      Date.now()

  });


  alertSecurity(
    `${
      event?.message ||
      "Suspicious activity"
    } · Violation ${
      attempt.violationCount
    }`
  );


  /*
    Optional question replacement.
  */

  if (
    config.replaceQuestionOnSwitch !==
    false
  ) {

    const used =
      new Set(
        questions.map(
          question =>
            String(
              question.id
            )
        )
      );


    const replacement =
      shuffle(pool).find(
        question =>
          !used.has(
            String(
              question.id
            )
          )
      );


    if (replacement) {

      delete attempt.answers[
        String(
          questions[current].id
        )
      ];


      questions[current] =
        replacement;


      attempt.questionIds[
        current
      ] =
        replacement.id;


      await sync({
        questionIds:
          attempt.questionIds
      });
    }
  }


  await sync();

  render();
}


/* =========================================================
   TIMER
========================================================= */

function startTimer() {

  const tick = () => {

    const left =
      Math.max(
        0,
        Number(
          attempt.endsAt
        ) -
        Date.now()
      );


    const minutes =
      Math.floor(
        left /
        60000
      );


    const seconds =
      Math.floor(
        (
          left %
          60000
        ) /
        1000
      );


    $("timer")
      .textContent =
        `${String(
          minutes
        ).padStart(2, "0")}:${String(
          seconds
        ).padStart(2, "0")}`;


    if (!left) {

      submitExam(true);
    }
  };


  tick();


  timerHandle =
    setInterval(
      tick,
      1000
    );
}


/* =========================================================
   CALCULATE RESULT
========================================================= */

function calculate() {

  let correct = 0;

  let wrong = 0;


  for (const question of questions) {

    const answer =
      attempt.answers?.[
        question.id
      ];


    const right =
      question.a ??
      question.answer;


    if (
      answer ===
      right
    ) {

      correct++;

    } else if (
      answer
    ) {

      wrong++;
    }
  }


  const unanswered =
    questions.length -
    correct -
    wrong;


  const score =
    Number(
      (
        correct -
        wrong *
          (
            Number(
              config.negativeMarking
            ) || 0
          ) -
        (
          attempt.penaltiesApplied ||
          0
        )
      ).toFixed(2)
    );


  return {
    correct,
    wrong,
    unanswered,
    score
  };
}


/* =========================================================
   SUBMIT
========================================================= */

async function submitExam(
  auto = false
) {

  if (submitting) return;

  submitting =
    true;


  clearInterval(
    timerHandle
  );


  monitor?.stop();


  save();


  const calculated =
    calculate();


  const tabTypes = [
    "tab-hidden",
    "window-blur",
    "fullscreen-exit",
    "viewport-change"
  ];


  const copyTypes = [
    "copy",
    "cut",
    "paste",
    "context-menu",
    "print",
    "selection"
  ];


  const questionSnapshot =
    questions.map(
      (question, index) => ({

        number:
          index + 1,

        id:
          question.id,

        question:
          question.q ??
          question.question,

        options:
          question.options,

        correctAnswer:
          question.a ??
          question.answer,

        selectedAnswer:
          attempt.answers?.[
            question.id
          ] ||
          "Not answered",

        image:
          question.image ||
          question.imageUrl ||
          ""

      })
    );


  const result = {

    ownerUid:
      auth.currentUser.uid,

    name:
      attempt.name,

    email:
      attempt.email,

    exam:
      config.examTitle ||
      "TestHub Examination",

    center:
      config.centerCode ||
      "",

    ...calculated,

    total:
      questions.length,

    answers:
      attempt.answers,

    questionIds:
      attempt.questionIds,

    questionSnapshot,

    tabSwitches:
      attempt.violations.filter(
        violation =>
          tabTypes.includes(
            violation.type
          )
      ).length,

    copiesAttempted:
      attempt.violations.filter(
        violation =>
          copyTypes.includes(
            violation.type
          )
      ).length,

    penaltiesApplied:
      attempt.penaltiesApplied ||
      0,

    violationCount:
      attempt.violationCount ||
      0,

    violations:
      attempt.violations,

    autoSubmitted:
      auto,

    timeTakenSeconds:
      Math.round(
        (
          Date.now() -
          attempt.startedAt
        ) /
        1000
      ),

    submittedAt:
      serverTimestamp()
  };


  try {

    await setDoc(
      doc(
        db,
        "results",
        attemptId
      ),
      result
    );


    await updateDoc(
      doc(
        db,
        "attempts",
        attemptId
      ),
      {

        status:
          "submitted",

        answers:
          attempt.answers,

        resultSummary:
          calculated,

        questionSnapshot,

        submittedAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()

      }
    );


    if (
      document.fullscreenElement
    ) {

      document
        .exitFullscreen()
        .catch(() => {});
    }


    showResult(
      result
    );


  } catch (error) {

    console.error(
      error
    );

    submitting =
      false;

    alert(
      "The result could not be submitted. Check your internet connection and try again."
    );
  }
}


/* =========================================================
   RESULT SCREEN
========================================================= */

function showResult(
  result
) {

  $("examView")
    .classList
    .add("hidden");

  $("resultView")
    .classList
    .remove("hidden");


  $("finalScore")
    .textContent =
      `${result.score}/${result.total}`;


  $("accuracy")
    .textContent =
      `${
        result.total
          ? Math.round(
              result.correct /
              result.total *
              100
            )
          : 0
      }%`;


  $("correctCount")
    .textContent =
      result.correct;


  $("wrongCount")
    .textContent =
      result.wrong;


  $("securitySummary")
    .textContent =
      `Tab/fullscreen: ${
        result.tabSwitches
      } · Copy/other: ${
        result.copiesAttempted
      } · Penalty: ${
        result.penaltiesApplied
      }`;


  $("reviewLedger")
    .innerHTML =
      "";


  questions.forEach(
    (question, index) => {

      const mine =
        attempt.answers?.[
          question.id
        ] ||
        "Not answered";


      const right =
        question.a ??
        question.answer;


      const item =
        document.createElement(
          "div"
        );


      item.className =
        `
          ledger-item
          ${
            mine === right
              ? "ok"
              : mine ===
                "Not answered"
                ? ""
                : "bad"
          }
        `;


      item.textContent =
        `Q${
          index + 1
        }. ${
          question.q ??
          question.question
        } | Your answer: ${
          mine
        } | Correct: ${
          right
        }`;


      $("reviewLedger")
        .append(item);
    }
  );


  /*
    Star rating
  */

  $("stars")
    .innerHTML =
      "";


  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const button =
      document.createElement(
        "button"
      );


    button.type =
      "button";


    button.className =
      "star";


    button.textContent =
      "★";


    button.onclick =
      () => {

        rating =
          i;


        document
          .querySelectorAll(
            ".star"
          )
          .forEach(
            (item, index) =>
              item.classList.toggle(
                "active",
                index < i
              )
          );
      };


    $("stars")
      .append(button);
  }


  /*
    Download area
  */

  let downloadBox =
    $("performanceDownloads");


  if (!downloadBox) {

    downloadBox =
      document.createElement(
        "div"
      );


    downloadBox.id =
      "performanceDownloads";


    downloadBox.style.cssText =
      `
        margin-top:20px;
        padding:18px;
        border:1px solid #dbe4f0;
        border-radius:12px;
        background:#f8fafc;
        text-align:left;
      `;


    downloadBox.innerHTML =
      `
        <h3 style="margin:0 0 6px">
          Download Performance
        </h3>

        <p
          style="
            margin:0 0 14px;
            color:#64748b;
            font-size:14px;
          "
        >
          Download your performance result
          and complete question/answer record.
        </p>

        <div
          style="
            display:flex;
            gap:10px;
            flex-wrap:wrap;
          "
        >

          <button
            id="downloadPerformanceBtn"
            type="button"
            style="
              border:0;
              border-radius:10px;
              padding:11px 15px;
              background:#2563eb;
              color:#fff;
              font-weight:800;
              cursor:pointer;
            "
          >
            ⬇ Download Performance Result
          </button>

          <button
            id="downloadQuestionsBtn"
            type="button"
            style="
              border:0;
              border-radius:10px;
              padding:11px 15px;
              background:#e2e8f0;
              color:#172033;
              font-weight:800;
              cursor:pointer;
            "
          >
            ⬇ Download Questions & Answers
          </button>

        </div>
      `;


    const target =
      $("reviewLedger");


    target.parentNode.insertBefore(
      downloadBox,
      target.nextSibling
    );
  }


  $("downloadPerformanceBtn")
    .onclick =
      () =>
        downloadPerformance(
          result
        );


  $("downloadQuestionsBtn")
    .onclick =
      () =>
        downloadQuestions(
          result
        );
}


/* =========================================================
   DOWNLOAD PERFORMANCE
========================================================= */

function downloadPerformance(
  result
) {

  const accuracy =
    result.total
      ? Math.round(
          result.correct /
          result.total *
          100
        )
      : 0;


  const html =
    `
    <!doctype html>

    <html>

    <head>

      <meta charset="utf-8">

      <title>
        Performance Result
      </title>

      <style>

        body{
          font-family:Arial,sans-serif;
          padding:30px;
          color:#172033;
        }

        h1{
          color:#1d4ed8;
        }

        .grid{
          display:grid;
          grid-template-columns:
            repeat(4,1fr);
          gap:12px;
        }

        .box{
          border:1px solid #dbe4f0;
          padding:15px;
          border-radius:10px;
        }

        .question{
          padding:12px 0;
          border-bottom:
            1px solid #eee;
        }

        @media(max-width:700px){
          .grid{
            grid-template-columns:1fr 1fr;
          }
        }

      </style>

    </head>

    <body>

      <h1>
        ${
          escapeText(
            config.examTitle ||
            "TestHub Examination"
          )
        }
      </h1>


      <p>

        <b>Student:</b>
        ${
          escapeText(
            result.name
          )
        }

        <br>

        <b>Email:</b>
        ${
          escapeText(
            result.email
          )
        }

        <br>

        <b>Center:</b>
        ${
          escapeText(
            config.centerCode ||
            "-"
          )
        }

      </p>


      <div class="grid">

        <div class="box">
          <b>Score</b>
          <br>
          ${
            result.score
          }/${result.total}
        </div>

        <div class="box">
          <b>Accuracy</b>
          <br>
          ${accuracy}%
        </div>

        <div class="box">
          <b>Correct</b>
          <br>
          ${result.correct}
        </div>

        <div class="box">
          <b>Wrong</b>
          <br>
          ${result.wrong}
        </div>

      </div>


      <h2>
        Security
      </h2>

      <p>

        Tab/fullscreen:
        ${result.tabSwitches}

        · Copy/other:
        ${result.copiesAttempted}

        · Penalty:
        ${result.penaltiesApplied}

      </p>


      <h2>
        Question Performance
      </h2>


      ${
        questions
          .map(
            (question, index) => {

              const mine =
                attempt.answers?.[
                  question.id
                ] ||
                "Not answered";


              const right =
                question.a ??
                question.answer;


              return `
                <div class="question">

                  <b>
                    Q${
                      index + 1
                    }.
                  </b>

                  ${
                    escapeText(
                      question.q ??
                      question.question
                    )
                  }

                  <br>

                  Your answer:
                  ${
                    escapeText(
                      mine
                    )
                  }

                  <br>

                  Correct answer:
                  ${
                    escapeText(
                      right
                    )
                  }

                </div>
              `;
            }
          )
          .join("")
      }

    </body>

    </html>
    `;


  downloadBlob(
    html,
    "testhub-performance-result.html",
    "text/html;charset=utf-8"
  );
}


/* =========================================================
   DOWNLOAD QUESTIONS + ANSWERS
========================================================= */

function downloadQuestions(
  result
) {

  const rows = [

    [
      "Question No",
      "Question",
      "Option A",
      "Option B",
      "Option C",
      "Option D",
      "Your Answer",
      "Correct Answer",
      "Result"
    ]

  ];


  questions.forEach(
    (question, index) => {

      const mine =
        attempt.answers?.[
          question.id
        ] ||
        "Not answered";


      const right =
        question.a ??
        question.answer;


      rows.push([

        index + 1,

        question.q ??
          question.question,

        question.options?.[0] ||
          "",

        question.options?.[1] ||
          "",

        question.options?.[2] ||
          "",

        question.options?.[3] ||
          "",

        mine,

        right,

        mine === right
          ? "Correct"
          : mine ===
            "Not answered"
            ? "Unanswered"
            : "Wrong"

      ]);
    }
  );


  const csv =
    "\ufeff" +
    rows
      .map(
        row =>
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


  downloadBlob(
    csv,
    "testhub-questions-answers.csv",
    "text/csv;charset=utf-8"
  );
}


/* =========================================================
   DOWNLOAD HELPERS
========================================================= */

function escapeText(
  value
) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char])
  );
}


function downloadBlob(
  content,
  filename,
  type
) {

  const url =
    URL.createObjectURL(
      new Blob(
        [content],
        {
          type
        }
      )
    );


  const link =
    document.createElement(
      "a"
    );


  link.href =
    url;

  link.download =
    filename;

  link.click();


  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    500
  );
}


/* =========================================================
   FEEDBACK
========================================================= */

$("feedbackBtn").onclick =
  async () => {

    if (!rating) {

      $("feedbackMsg")
        .textContent =
          "Rating required.";

      $("feedbackMsg")
        .className =
          "notice error";

      return;
    }


    try {

      await updateDoc(
        doc(
          db,
          "results",
          attemptId
        ),
        {

          rating,

          doubt:
            $("doubt")
              .value
              .trim(),

          feedback:
            $("feedback")
              .value
              .trim(),

          feedbackAt:
            serverTimestamp()

        }
      );


      $("feedbackMsg")
        .textContent =
          "Feedback successfully saved.";

      $("feedbackMsg")
        .className =
          "notice";


      $("feedbackBtn")
        .disabled =
          true;


    } catch (error) {

      $("feedbackMsg")
        .textContent =
          "Feedback save failed: " +
          error.message;

      $("feedbackMsg")
        .className =
          "notice error";
    }
  };


/* =========================================================
   FINAL MESSAGE
========================================================= */

$("feedbackBtn")
  .addEventListener(
    "click",
    () => {

      setTimeout(
        () => {

          if (
            $("feedbackBtn")
              .disabled
          ) {

            alert(
              "Your test was submitted successfully."
            );
          }

        },
        700
      );

    }
  );


/* =========================================================
   TEXT REPLACEMENT
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const replacements = {

      "Exam Instructions":
        "Exam Instructions",

      "Start Exam":
        "Start Exam",

      "Exam Submitted":
        "Exam Submitted",

      "Continue":
        "Continue",

      "Previous":
        "Previous",

      "Green: answered · Yellow: marked for review":
        "Green: answered · Yellow: review",

      "Loading exam information...":
        "Loading exam information…"

    };


    document
      .querySelectorAll(
        "body *"
      )
      .forEach(element => {

        if (
          element.children.length ===
          0
        ) {

          const currentText =
            element.textContent.trim();

          if (
            replacements[
              currentText
            ]
          ) {

            element.textContent =
              replacements[
                currentText
              ];
          }
        }
      });
  });
