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
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-functions.js";

import {
  SecurityMonitor
} from "./security.js";


const firebaseConfig = {
  apiKey: "AIzaSyBp1JrZy_dsJbXmg0jPfZrVEg7vlMbwRkM",
  authDomain: "testhub-43fd8.firebaseapp.com",
  projectId: "testhub-43fd8",
  storageBucket: "testhub-43fd8.firebasestorage.app",
  messagingSenderId: "530965492161",
  appId: "1:530965492161:web:b8ea984ef0c9cb14763f40"
};


const app =
  initializeApp(
    firebaseConfig
  );


const auth =
  getAuth(app);


const db =
  getFirestore(app);


const $ =
  id =>
    document.getElementById(id);


let config;

let questions = [];

let pool = [];

let attempt = null;

let attemptId = "";

let current = 0;

let timerHandle = null;

let monitor = null;

let submitting = false;

let pendingCandidate = null;

let rating = 0;


/* STEP 7 */

let attemptUnsubscribe = null;

let forceSubmitHandled = false;


/* STEP 1 security protection */

let securityReady = false;

let securityGraceUntil = 0;

let fullscreenInit = false;


/* =========================================================
   HELPERS
========================================================= */

const normalizeEmail =
  value =>
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


const asMillis =
  value => {

    if (value?.toMillis) {
      return value.toMillis();
    }

    if (value?.seconds) {
      return value.seconds * 1000;
    }

    if (
      typeof value ===
      "number"
    ) {
      return value;
    }

    const parsed =
      Date.parse(value);

    return Number.isNaN(
      parsed
    )
      ? 0
      : parsed;

  };


const shuffle =
  array => {

    const copy = [
      ...array
    ];


    for (
      let i =
        copy.length - 1;
      i > 0;
      i--
    ) {

      const j =
        Math.floor(
          Math.random() *
          (i + 1)
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


async function hash(
  value
) {

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
      x =>
        x
          .toString(16)
          .padStart(
            2,
            "0"
          )
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

  $("loginMessage").textContent =
    text;


  $("loginMessage").className =
    `notice${
      error
        ? " error"
        : ""
    }`;


  $("loginMessage")
    .classList
    .remove(
      "hidden"
    );

}


/* =========================================================
   BRANDING
========================================================= */

function applyBrand() {

  const name =
    config?.instituteName?.trim() ||
    "TestHub";


  $("instituteName")
    .textContent =
    name;


  document.title =
    `${name} | Secure Examination`;


  if (
    config?.instituteLogo
  ) {

    $("loginLogo").src =
      config.instituteLogo;


    $("loginLogo")
      .classList
      .remove(
        "hidden"
      );


    $("loginFallback")
      .classList
      .add(
        "hidden"
      );

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


    if (
      !snapshot.exists()
    ) {

      throw Error(
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

      throw Error(
        "The exam is currently closed."
      );

    }


    if (
      start &&
      now < start
    ) {

      throw Error(
        `The exam will start on ${
          new Date(
            start
          ).toLocaleString(
            "en-IN"
          )
        }.`
      );

    }


    if (
      end &&
      now > end
    ) {

      throw Error(
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
      .disabled =
      false;


  } catch (error) {

    $("examInfo")
      .textContent =
      error.message;


    $("examInfo")
      .classList
      .add(
        "error"
      );

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


    signInAnonymously(
      auth
    )
      .catch(
        error => {

          $("examInfo")
            .textContent =
            "Enable Firebase Anonymous Authentication: " +
            error.message;

          $("examInfo")
            .classList
            .add(
              "error"
            );

        }
      );

  }
);


/* =========================================================
   CANDIDATE FORM
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


    const code =
      $("centerCode")
        .value
        .trim();


    if (
      !name ||
      !email
    ) {

      return message(
        "Full name and email are required.",
        true
      );

    }


    if (
      config.centerCode &&
      code !==
        String(
          config.centerCode
        ).trim()
    ) {

      return message(
        "The Exam Center Code is incorrect.",
        true
      );

    }


    pendingCandidate = {

      name,

      email,

      centerCode:
        code

    };


    $("configSummary").innerHTML = `

      <div>
        <b>
          ${config.examTitle ||
            "TestHub Examination"}
        </b>
      </div>

      <div>
        Duration:
        ${
          config.durationMinutes ||
          30
        } minutes
      </div>

      <div>
        Questions:
        ${
          config.studentLimit ||
          10
        }
      </div>

      <div>
        Negative:
        ${
          config.negativeMarking ||
          0
        }
      </div>

      <div>
        Violations:
        ${
          config.maxTabSwitches ||
          config.autoSubmitAfter ||
          3
        }
      </div>

    `;


    $("loginView")
      .classList
      .add(
        "hidden"
      );


    $("instructionsView")
      .classList
      .remove(
        "hidden"
      );

  };


/* =========================================================
   BACK
========================================================= */

$("backBtn").onclick =
  () => {

    $("instructionsView")
      .classList
      .add(
        "hidden"
      );


    $("loginView")
      .classList
      .remove(
        "hidden"
      );

  };


/* =========================================================
   CONSENT
========================================================= */

$("consent").onchange =
  () => {

    $("startBtn").disabled =
      !$("consent")
        .checked;

  };


$("startBtn").onclick =
  prepareExam;


/* =========================================================
   QUESTION VALIDATION
========================================================= */

function validate(
  bank
) {

  if (
    !Array.isArray(bank)
  ) {

    throw Error(
      "The question bank format is invalid."
    );

  }


  for (
    const question
    of bank
  ) {

    const text =
      question.q ??
      question.question;


    const answer =
      question.a ??
      question.answer;


    if (

      question.id ==
      null ||

      !text ||

      !Array.isArray(
        question.options
      ) ||

      question.options.length < 2 ||

      !question.options.includes(
        answer
      )

    ) {

      throw Error(
        `Question ${
          question.id ??
          "?"
        } is invalid.`
      );

    }

  }

}


/* =========================================================
   QUESTION SOURCE
========================================================= */

async function loadSource(
  source
) {

  const path =
    String(
      source ||
      "chapter.json"
    )
      .trim();


  const response =
    await fetch(
      `./${path}`,
      {
        cache:
          "no-store"
      }
    );


  if (
    !response.ok
  ) {

    throw Error(
      `Question source could not be loaded: ${path}`
    );

  }


  const data =
    await response.json();


  validate(
    data
  );


  return data;

}


/* =========================================================
   BUILD POOL
========================================================= */

async function getPool() {

  if (
    Array.isArray(
      config.subjects
    ) &&
    config.subjects.length
  ) {

    const output = [];


    for (
      const subject
      of config.subjects
    ) {

      const count =
        Number(
          subject.count
        ) || 0;


      if (
        count <= 0
      ) {
        continue;
      }


      const name =
        String(
          subject.name ||
          "Subject"
        ).trim();


      const source =
        String(
          subject.source ||
          "chapter.json"
        ).trim();


      const order =
        subject.order ===
        "sequential"
          ? "sequential"
          : "random";


      const sourceQuestions =
        await loadSource(
          source
        );


      const selected =
        order ===
        "sequential"

          ? sourceQuestions.slice(
              0,
              Math.min(
                count,
                sourceQuestions.length
              )
            )

          : shuffle(
              sourceQuestions
            ).slice(
              0,
              Math.min(
                count,
                sourceQuestions.length
              )
            );


      output.push(
        ...selected.map(
          question => ({

            ...question,

            __subject:
              name,

            __source:
              source

          })
        )
      );

    }


    return output;

  }


  const legacy =
    await loadSource(
      config.questionSource ||
      "chapter.json"
    );


  const limit =
    Number(
      config.studentLimit
    ) ||
    legacy.length;


  const order =
    config.questionOrder ===
    "sequential"
      ? "sequential"
      : "random";


  const selected =
    order ===
    "sequential"

      ? legacy.slice(
          0,
          Math.min(
            limit,
            legacy.length
          )
        )

      : shuffle(
          legacy
        ).slice(
          0,
          Math.min(
            limit,
            legacy.length
          )
        );


  return selected.map(
    question => ({

      ...question,

      __subject:
        "All Questions",

      __source:
        config.questionSource ||
        "chapter.json"

    })
  );

}


/* =========================================================
   PREPARE EXAM
========================================================= */

async function prepareExam() {
  const button = $("startBtn");
  button.disabled = true;
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    if (!pendingCandidate) throw Error("Full name and email are required.");

    attemptId = await hash(`${config.examId || "current_test"}::${pendingCandidate.email}::${auth.currentUser.uid}`);

    try {
      const resumed = await callGetAttempt({ attemptId });
      const data = resumed.data;
      attempt = { ...(data || {}), ownerUid: auth.currentUser.uid };
      attemptId = data.attemptId || attemptId;
      questions = Array.isArray(data.questions) ? data.questions : [];
      current = Number(data.currentIndex || 0);
      if (!questions.length) throw Error("The saved examination questions could not be loaded.");
      startExam(true);
      return;
    } catch (resumeError) {
      const code = String(resumeError?.code || "");
      if (!code.includes("not-found")) throw resumeError;
    }

    const started = await callStartExam({ attemptId, name: pendingCandidate.name, email: pendingCandidate.email, centerCode: pendingCandidate.centerCode });
    const data = started.data;
    attemptId = data.attemptId;
    questions = Array.isArray(data.questions) ? data.questions : [];
    if (!questions.length) throw Error("The question bank is empty.");

    attempt = {
      ownerUid: auth.currentUser.uid, name: pendingCandidate.name, email: pendingCandidate.email,
      centerCode: pendingCandidate.centerCode, examId: config.examId || "current_test",
      exam: config.examTitle || "TestHub Examination", examTitle: data.examTitle || config.examTitle || "TestHub Examination",
      status: "in_progress", startedAt: Number(data.startedAt || Date.now()), endsAt: Number(data.endsAt || Date.now()),
      currentIndex: 0, questionIds: questions.map(q => q.id),
      questionSubjects: questions.map(q => q.section || "General"),
      answers: {}, review: [], violations: [], violationCount: 0, penaltiesApplied: 0, forceSubmitRequested: false
    };
    startExam(false);
  } catch (error) {
    message(error.message || "Unable to start the examination.", true);
    $("instructionsView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
}


/* =========================================================
   STEP 7
   REAL-TIME ATTEMPT LISTENER
========================================================= */

function startAttemptListener() {

  if (
    attemptUnsubscribe
  ) {

    attemptUnsubscribe();

    attemptUnsubscribe =
      null;

  }


  attemptUnsubscribe =
    onSnapshot(

      doc(
        db,
        "attempts",
        attemptId
      ),

      snapshot => {

        if (
          !snapshot.exists()
        ) {
          return;
        }


        const remote =
          snapshot.data();


        /*
           Keep our local attempt
           synchronized with the server.
        */

        attempt = { ...attempt, ...remote };
        if (Array.isArray(remote.questions) && remote.questions.length) questions = remote.questions;


        /*
           ADMIN FORCE SUBMIT
        */

        if (
          remote.forceSubmitRequested ===
            true &&
          !forceSubmitHandled &&
          remote.status !==
            "submitted"
        ) {

          forceSubmitHandled =
            true;


          alert(
            "The administrator has requested submission of your examination."
          );


          submitExam(
            true
          );

          return;

        }


        /*
           If another device/session has
           already submitted the exam,
           don't continue the test.
        */

        if (
          ["submitted", "auto_submitted"].includes(remote.status) &&
          !submitting
        ) {

          submitting =
            true;


          clearInterval(
            timerHandle
          );


          monitor?.stop();


          $("examView")
            .classList
            .add(
              "hidden"
            );


          $("resultView")
            .classList
            .remove(
              "hidden"
            );

        }


        render();

      },

      error => {

        console.error(
          "Attempt listener failed:",
          error
        );

      }

    );

}


/* =========================================================
   START EXAM
========================================================= */

async function startExam(
  resumed
) {

  $("instructionsView")
    .classList
    .add(
      "hidden"
    );


  $("examView")
    .classList
    .remove(
      "hidden"
    );


  $("examTitle")
    .textContent =
    config.examTitle ||
    "TestHub Examination";


  $("candidateLabel")
    .textContent =
    `${attempt.name} · ${attempt.email}`;


  forceSubmitHandled =
    false;


  render();


  startTimer();


  /*
     IMPORTANT:
     Fullscreen request happens before
     security monitoring becomes active.
  */

  fullscreenInit =
    true;


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
          submitExam(
            true
          )

    });


  try {

    await monitor
      .requestFullscreen();

  } catch (error) {

    console.warn(
      "Fullscreen request:",
      error
    );

  }


  monitor.start();


  setTimeout(
    () => {

      securityReady =
        true;

      fullscreenInit =
        false;

      securityGraceUntil =
        0;

    },
    4000
  );


  /*
     Start real-time admin control
     listener after attempt is active.
  */

  startAttemptListener();


  if (resumed) {
    await sync();
  }

}


/* =========================================================
   RENDER
========================================================= */

function render() {

  const question =
    questions[current];


  if (!question) {
    return;
  }


  $("questionNumber")
    .textContent =
    `Question ${
      current + 1
    }/${
      questions.length
    }`;


  const subjectElement =
    $("questionSubject");


  if (
    subjectElement
  ) {

    subjectElement
      .textContent =
      question.__subject ||
      "General";

  }


  $("questionText")
    .textContent =
    question.q ??
    question.question;


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
    .innerHTML =
    "";


  question.options
    .forEach(
      (
        option,
        index
      ) => {

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
            String(
              question.id
            )
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
          .append(
            label
          );

      }
    );


  $("palette")
    .innerHTML =
    "";


  questions.forEach(
    (
      item,
      index
    ) => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        `qbtn ${
          index === current
            ? "current"
            : ""
        } ${
          attempt.answers?.[
            String(
              item.id
            )
          ]
            ? "answered"
            : ""
        } ${
          attempt.review?.includes(
            item.id
          )
            ? "review"
            : ""
        }`;


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
        .append(
          button
        );

    }
  );


  $("prevBtn")
    .disabled =
    current === 0;


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
   SAVE
========================================================= */

function save() {

  const selected =
    document.querySelector(
      'input[name="answer"]:checked'
    );


  if (!selected) {
    return;
  }


  const question =
    questions[current];


  if (!question) {
    return;
  }


  if (!attempt.answers) {

    attempt.answers =
      {};

  }


  attempt.answers[
    String(
      question.id
    )
  ] =
    selected.value;

}


/* =========================================================
   SYNC
========================================================= */

async function sync(extra = {}) {
  Object.assign(attempt, extra, { currentIndex: current });
  try {
    await callSaveAnswers({ attemptId, answers: attempt.answers || {} });
    await callSaveNavigation({ attemptId, currentIndex: current, review: Array.isArray(attempt.review) ? attempt.review : [], visited: {} });
  } catch (error) {
    console.error("Secure attempt sync failed:", error);
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


    const index =
      attempt.review.indexOf(
        id
      );


    if (
      index < 0
    ) {

      attempt.review.push(
        id
      );

    } else {

      attempt.review.splice(
        index,
        1
      );

    }


    sync();

    render();

  };


$("submitBtn").onclick =
  () => {

    if (
      confirm(
        "Do you want to submit the exam now?"
      )
    ) {

      submitExam(
        false
      );

    }

  };


/* =========================================================
   SECURITY
========================================================= */

function alertSecurity(
  text
) {

  $("securityAlert")
    .textContent =
    text;


  $("securityAlert")
    .classList
    .remove(
      "hidden"
    );


  setTimeout(
    () =>
      $("securityAlert")
        .classList
        .add(
          "hidden"
        ),
    3500
  );

}


async function violation(event) {
  if (!securityReady || Date.now() < securityGraceUntil || submitting) return;
  alertSecurity(event.message || "Suspicious activity");
  try {
    const response = await callRecordViolation({ attemptId, type: event.type, message: event.message || "" });
    const data = response.data || {};
    attempt.violationCount = Number(data.violationCount ?? attempt.violationCount ?? 0);
    attempt.penaltiesApplied = Number(data.penaltiesApplied ?? attempt.penaltiesApplied ?? 0);
    if (data.autoSubmit) await submitExam(true);
  } catch (error) { console.error("Security violation could not be recorded:", error); }
}



/* =========================================================
   TIMER
========================================================= */

function startTimer() {

  const tick =
    () => {

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
        ).padStart(
          2,
          "0"
        )}:` +
        `${String(
          seconds
        ).padStart(
          2,
          "0"
        )}`;


      if (!left) {

        submitExam(
          true
        );

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
   SCORE
========================================================= */

function calculate() {

  let correct =
    0;

  let wrong =
    0;


  for (
    const question
    of questions
  ) {

    const answer =
      attempt.answers?.[
        String(
          question.id
        )
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

async function submitExam(autoSubmitted = false) {
  if (submitting) return;
  submitting = true;
  clearInterval(timerHandle);
  monitor?.stop();
  if (attemptUnsubscribe) { attemptUnsubscribe(); attemptUnsubscribe = null; }
  try {
    save();
    await callSaveAnswers({ attemptId, answers: attempt.answers || {} });
    await callSaveNavigation({ attemptId, currentIndex: current, review: Array.isArray(attempt.review) ? attempt.review : [], visited: {} });
    const response = await callSubmitExam({ attemptId, autoSubmitted: Boolean(autoSubmitted) });
    const result = response.data?.result;
    if (!result) throw Error("The server did not return a final result.");
    attempt = { ...attempt, status: result.status || "submitted" };
    showResult(result);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (error) {
    console.error("Secure submission error:", error);
    submitting = false;
    alert("The result could not be submitted.\n\n" + (error.message || "Check your internet connection and try again."));
  }
}


function showResult(
  result
) {

  $("examView")
    .classList
    .add(
      "hidden"
    );


  $("resultView")
    .classList
    .remove(
      "hidden"
    );


  $("finalScore")
    .textContent =
    `${
      result.score
    }/${
      result.total
    }`;


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
    } · ` +
    `Copy/other: ${
      result.copiesAttempted
    } · ` +
    `Penalty: ${
      result.penaltiesApplied
    }`;


  $("reviewLedger")
    .innerHTML =
    "";


  questions.forEach(
    (
      question,
      index
    ) => {

      const mine =
        attempt.answers?.[
          String(
            question.id
          )
        ] ||
        "Not answered";


      const right =
        question.a ??
        question.answer;


      const div =
        document.createElement(
          "div"
        );


      div.textContent =
        `Q${
          index + 1
        }. ${
          question.q ??
          question.question
        } | ` +
        `Your answer: ${
          mine
        } | ` +
        `Correct: ${
          right
        }`;


      $("reviewLedger")
        .append(
          div
        );

    }
  );


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
            "#stars .star"
          )
          .forEach(
            (
              star,
              index
            ) => {

              star.classList.toggle(
                "active",
                index < i
              );

            }
          );

      };


    $("stars")
      .append(
        button
      );

  }

}


/* =========================================================
   FEEDBACK
========================================================= */

$("feedbackBtn").onclick =
  async () => {

    if (
      !rating
    ) {

      $("feedbackMsg")
        .textContent =
        "Rating required.";

      $("feedbackMsg")
        .className =
        "notice error";

      return;

    }


    try {

      await callSaveFeedback({
        attemptId,
        rating,
        doubt: $("doubt").value.trim(),
        feedback: $("feedback").value.trim()
      });


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
