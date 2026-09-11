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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);


/* =========================================================
   GLOBAL STATE
========================================================= */

let config = null;

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


/* Security startup protection */
let securityReady = false;
let securityGraceUntil = 0;


/* =========================================================
   HELPERS
========================================================= */

const normalizeEmail = value =>
  String(value || "").trim().toLowerCase();


const asMillis = value => {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};


const shuffle = array => {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
};


async function hash(value) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return [...new Uint8Array(buffer)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}


function message(text, error = false) {
  const map = {
    "The exam is not configured yet.":
      "The exam is not configured yet.",

    "The exam is currently closed.":
      "The exam is currently closed.",

    "The exam window has ended.":
      "The exam window has ended.",

    "Full name and email are required.":
      "Full name and email are required.",

    "The Exam Center Code is incorrect.":
      "The Exam Center Code is incorrect.",

    "An exam attempt already exists for this email.":
      "An exam attempt already exists for this email.",

    "This email has already submitted the exam.":
      "This email has already submitted the exam.",

    "Some saved questions are no longer available.":
      "Some saved questions are no longer available.",

    "The question bank is empty.":
      "The question bank is empty."
  };

  const finalText = map[text] || text;

  $("loginMessage").textContent = finalText;
  $("loginMessage").className =
    `notice${error ? " error" : ""}`;
}


/* =========================================================
   BRANDING
========================================================= */

function applyBrand() {
  const name =
    config?.instituteName?.trim() || "TestHub";

  $("instituteName").textContent = name;

  document.title =
    `${name} | Secure Examination`;

  if (config?.instituteLogo) {
    $("loginLogo").src = config.instituteLogo;
    $("loginLogo").classList.remove("hidden");
    $("loginFallback").classList.add("hidden");
  }
}


/* =========================================================
   LOAD EXAM CONFIG
========================================================= */

async function loadConfig() {
  try {
    const snap = await getDoc(
      doc(db, "exam_config", "current_test")
    );

    if (!snap.exists()) {
      throw Error("The exam is not configured yet.");
    }

    config = snap.data();

    applyBrand();

    const now = Date.now();

    const start = asMillis(config.windowStart);
    const end = asMillis(config.windowEnd);

    if (config.examActive === false) {
      throw Error("The exam is currently closed.");
    }

    if (start && now < start) {
      throw Error(
        `The exam will start on ${new Date(start).toLocaleString("en-IN")}.`
      );
    }

    if (end && now > end) {
      throw Error("The exam window has ended.");
    }

    const totalQuestions =
      Number(config.studentLimit) ||
      Number(config.totalPool) ||
      0;

    $("examInfo").textContent =
      `${config.examTitle || "TestHub Examination"} · ` +
      `${config.durationMinutes || 30} minutes · ` +
      `${totalQuestions || "Configured"} questions`;

    $("continueBtn").disabled = false;

  } catch (error) {

    $("examInfo").textContent =
      error.message || "Unable to load exam configuration.";

    $("examInfo").classList.add("error");
  }
}


/* =========================================================
   AUTH
========================================================= */

onAuthStateChanged(auth, user => {

  if (user) {
    loadConfig();
    return;
  }

  signInAnonymously(auth).catch(error => {

    $("examInfo").textContent =
      "Enable Firebase Anonymous Authentication: " +
      error.message;

    $("examInfo").classList.add("error");
  });

});


/* =========================================================
   CANDIDATE FORM
========================================================= */

$("candidateForm").onsubmit = event => {

  event.preventDefault();

  const name =
    $("candidateName").value.trim();

  const email =
    normalizeEmail($("candidateEmail").value);

  const code =
    $("centerCode").value.trim();


  if (!name || !email) {
    return message(
      "Full name and email are required.",
      true
    );
  }


  if (
    config.centerCode &&
    code !== String(config.centerCode).trim()
  ) {
    return message(
      "The Exam Center Code is incorrect.",
      true
    );
  }


  pendingCandidate = {
    name,
    email,
    centerCode: code
  };


  const totalQuestions =
    Number(config.studentLimit) ||
    Number(config.totalPool) ||
    0;


  $("configSummary").innerHTML = `
    <div>
      <b>${config.durationMinutes || 30}</b><br>
      Minutes
    </div>

    <div>
      <b>${totalQuestions || "-"}</b><br>
      Questions
    </div>

    <div>
      <b>${config.negativeMarking || 0}</b><br>
      Negative
    </div>

    <div>
      <b>${config.maxTabSwitches || config.autoSubmitAfter || 3}</b><br>
      Violations
    </div>
  `;


  $("loginView").classList.add("hidden");
  $("instructionsView").classList.remove("hidden");
};


/* =========================================================
   BACK
========================================================= */

$("backBtn").onclick = () => {

  $("instructionsView").classList.add("hidden");
  $("loginView").classList.remove("hidden");

};


/* =========================================================
   CONSENT
========================================================= */

$("consent").onchange = () => {

  $("startBtn").disabled =
    !$("consent").checked;

};

$("startBtn").onclick = prepareExam;


/* =========================================================
   QUESTION VALIDATION
========================================================= */

function validateQuestionBank(bank) {

  if (!Array.isArray(bank)) {
    throw Error(
      "The question bank format is invalid."
    );
  }


  for (const question of bank) {

    const questionText =
      question.q ?? question.question;

    const answer =
      question.a ?? question.answer;


    if (
      question.id == null ||
      !questionText ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      !question.options.includes(answer)
    ) {
      throw Error(
        `Question ${question.id ?? "?"} is invalid.`
      );
    }
  }

}


/* =========================================================
   LOAD QUESTION SOURCE
========================================================= */

async function loadQuestionSource(source) {

  const path =
    String(source || "chapter.json").trim();

  const response =
    await fetch(`./${path}`, {
      cache: "no-store"
    });


  if (!response.ok) {
    throw Error(
      `Question source could not be loaded: ${path}`
    );
  }


  const data = await response.json();

  validateQuestionBank(data);

  return data;
}


/* =========================================================
   BUILD QUESTION POOL
========================================================= */

async function getConfiguredQuestionPool() {

  /*
     New admin configuration:

     subjects: [
       {
         name: "Physics",
         count: 30,
         source: "physics.json",
         order: "random"
       },
       {
         name: "Chemistry",
         count: 30,
         source: "chemistry.json",
         order: "sequential"
       }
     ]
  */


  if (
    Array.isArray(config.subjects) &&
    config.subjects.length
  ) {

    const finalQuestions = [];

    for (const subject of config.subjects) {

      const subjectName =
        String(subject.name || "Subject").trim();

      const requestedCount =
        Number(subject.count) || 0;

      if (requestedCount <= 0) {
        continue;
      }


      const source =
        String(
          subject.source || "chapter.json"
        ).trim();


      const order =
        subject.order === "sequential"
          ? "sequential"
          : "random";


      const subjectBank =
        await loadQuestionSource(source);


      let selected;


      if (order === "sequential") {

        selected =
          [...subjectBank].slice(
            0,
            Math.min(
              requestedCount,
              subjectBank.length
            )
          );

      } else {

        selected =
          shuffle(subjectBank).slice(
            0,
            Math.min(
              requestedCount,
              subjectBank.length
            )
          );
      }


      /*
         Attach subject information without
         changing original question structure.
      */

      selected = selected.map(question => ({
        ...question,
        __subject: subjectName,
        __source: source
      }));


      finalQuestions.push(...selected);
    }


    /*
       Global student question limit.
    */

    const configuredLimit =
      Number(config.studentLimit) || 0;


    if (configuredLimit > 0) {
      return finalQuestions.slice(
        0,
        configuredLimit
      );
    }


    return finalQuestions;
  }


  /*
     Backward compatibility with old configuration.
  */

  const legacyBank =
    await loadQuestionSource(
      config.questionSource || "chapter.json"
    );


  const limit =
    Number(config.studentLimit) ||
    legacyBank.length;


  const order =
    config.questionOrder === "sequential"
      ? "sequential"
      : "random";


  const selected =
    order === "sequential"
      ? legacyBank.slice(
          0,
          Math.min(limit, legacyBank.length)
        )
      : shuffle(legacyBank).slice(
          0,
          Math.min(limit, legacyBank.length)
        );


  return selected.map(question => ({
    ...question,
    __subject: "All Questions",
    __source:
      config.questionSource || "chapter.json"
  }));
}


/* =========================================================
   PREPARE EXAM
========================================================= */

async function prepareExam() {

  const button = $("startBtn");

  button.disabled = true;


  try {

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }


    if (!pendingCandidate) {
      throw Error(
        "Full name and email are required."
      );
    }


    attemptId =
      await hash(
        pendingCandidate.email
      );


    const attemptRef =
      doc(db, "attempts", attemptId);


    const existing =
      await getDoc(attemptRef);


    pool =
      await getConfiguredQuestionPool();


    if (existing.exists()) {

      attempt = existing.data();


      if (
        attempt.ownerUid !==
        auth.currentUser.uid
      ) {
        throw Error(
          "An exam attempt already exists for this email."
        );
      }


      if (attempt.status === "submitted") {
        throw Error(
          "This email has already submitted the exam."
        );
      }


      const map =
        new Map(
          pool.map(q => [
            String(q.id),
            q
          ])
        );


      questions =
        (attempt.questionIds || [])
          .map(id =>
            map.get(String(id))
          )
          .filter(Boolean);


      if (
        questions.length !==
        (attempt.questionIds || []).length
      ) {
        throw Error(
          "Some saved questions are no longer available."
        );
      }


      current =
        Number(attempt.currentIndex || 0);


      startExam(true);

      return;
    }


    questions = pool;


    if (!questions.length) {
      throw Error(
        "The question bank is empty."
      );
    }


    const startedAt = Date.now();


    attempt = {

      ownerUid:
        auth.currentUser.uid,

      name:
        pendingCandidate.name,

      email:
        pendingCandidate.email,

      centerCode:
        pendingCandidate.centerCode || "",

      examId:
        config.examId || "current_test",

      exam:
        config.examTitle ||
        "TestHub Examination",

      examTitle:
        config.examTitle ||
        "TestHub Examination",

      status:
        "in_progress",

      startedAt,

      endsAt:
        startedAt +
        (Number(config.durationMinutes) || 30) *
        60000,

      currentIndex:
        0,

      questionIds:
        questions.map(q => q.id),

      questionSubjects:
        questions.map(q => q.__subject || "General"),

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
        updatedAt: serverTimestamp()
      }
    );


    startExam(false);


  } catch (error) {

    message(
      error.message ||
        "Unable to start the exam.",
      true
    );


    $("instructionsView").classList.add("hidden");
    $("loginView").classList.remove("hidden");

    button.disabled = false;
  }

}


/* =========================================================
   START EXAM
========================================================= */

async function startExam(resumed) {

  $("instructionsView").classList.add("hidden");
  $("examView").classList.remove("hidden");


  $("examTitle").textContent =
    config.examTitle ||
    "TestHub Examination";


  $("candidateLabel").textContent =
    `${attempt.name} · ${attempt.email}`;


  render();

  startTimer();


  /*
     IMPORTANT:
     Fullscreen initialization must happen
     BEFORE security monitor starts.
  */

  securityReady = false;

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
        () => submitExam(true)
    });


  try {

    await monitor.requestFullscreen();

  } catch (error) {

    console.warn(
      "Fullscreen request:",
      error
    );
  }


  monitor.start();


  setTimeout(() => {

    securityReady = true;
    securityGraceUntil = 0;

  }, 4000);


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


  $("questionNumber").textContent =
    `Question ${current + 1}/${questions.length}`;


  $("questionText").textContent =
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
    $("questionImage").src =
      image;
  }


  $("options").innerHTML = "";


  question.options.forEach(
    (option, index) => {

      const label =
        document.createElement("label");

      const radio =
        document.createElement("input");

      const span =
        document.createElement("span");


      label.className = "option";

      radio.type = "radio";
      radio.name = "answer";
      radio.value = option;

      radio.checked =
        attempt.answers?.[
          String(question.id)
        ] === option;


      span.textContent =
        `${String.fromCharCode(65 + index)}. ${option}`;


      label.append(
        radio,
        span
      );


      $("options").append(label);
    }
  );


  /*
     Subject badge.
     Uses existing questionText area,
     so HTML change is not required.
  */

  const subjectName =
    question.__subject || "General";


  if (subjectName) {

    $("questionText").setAttribute(
      "data-subject",
      subjectName
    );
  }


  $("palette").innerHTML = "";


  questions.forEach(
    (item, index) => {

      const button =
        document.createElement("button");


      button.className =
        `qbtn` +
        `${index === current ? " current" : ""}` +
        `${attempt.answers?.[
          String(item.id)
        ] ? " answered" : ""}` +
        `${attempt.review?.includes(item.id)
          ? " review"
          : ""}`;


      button.textContent =
        index + 1;


      button.onclick = () => {

        save();

        current = index;

        sync();

        render();
      };


      $("palette").append(button);

    }
  );


  $("prevBtn").disabled =
    current === 0;


  $("securityCount").textContent =
    `Violations: ${attempt.violationCount || 0}`;


  $("penaltyCount").textContent =
    `Penalty: ${attempt.penaltiesApplied || 0}`;

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


  const question =
    questions[current];


  if (!question) return;


  if (!attempt.answers) {
    attempt.answers = {};
  }


  attempt.answers[
    String(question.id)
  ] = selected.value;
}


/* =========================================================
   SYNC ATTEMPT
========================================================= */

async function sync(extra = {}) {

  Object.assign(
    attempt,
    extra,
    {
      currentIndex: current
    }
  );


  try {

    await updateDoc(
      doc(db, "attempts", attemptId),
      {
        answers:
          attempt.answers || {},

        review:
          attempt.review || [],

        currentIndex:
          current,

        violations:
          attempt.violations || [],

        violationCount:
          attempt.violationCount || 0,

        penaltiesApplied:
          attempt.penaltiesApplied || 0,

        ...extra,

        updatedAt:
          serverTimestamp()
      }
    );

  } catch (error) {

    console.error(
      "Attempt sync failed:",
      error
    );

  }

}


/* =========================================================
   NAVIGATION
========================================================= */

$("prevBtn").onclick = () => {

  save();

  current =
    Math.max(
      0,
      current - 1
    );

  sync();

  render();
};


$("saveNextBtn").onclick = () => {

  save();

  current =
    Math.min(
      questions.length - 1,
      current + 1
    );

  sync();

  render();
};


$("reviewBtn").onclick = () => {

  save();

  const id =
    questions[current].id;


  const index =
    attempt.review.indexOf(id);


  if (index < 0) {
    attempt.review.push(id);
  } else {
    attempt.review.splice(index, 1);
  }


  sync();

  render();
};


$("submitBtn").onclick = () => {

  if (
    confirm(
      "Do you want to submit the exam now?"
    )
  ) {
    submitExam(false);
  }

};


/* =========================================================
   SECURITY ALERT
========================================================= */

function alertSecurity(text) {

  $("securityAlert").textContent =
    text;

  $("securityAlert")
    .classList
    .remove("hidden");


  setTimeout(() => {

    $("securityAlert")
      .classList
      .add("hidden");

  }, 3500);

}


/* =========================================================
   SECURITY VIOLATION
========================================================= */

async function violation(event) {

  /*
     Ignore fullscreen startup transition
     and initial security setup.
  */

  if (
    !securityReady ||
    Date.now() < securityGraceUntil
  ) {
    return;
  }


  if (submitting) return;


  attempt.violationCount =
    Number(attempt.violationCount || 0) + 1;


  attempt.penaltiesApplied =
    Number(
      (
        Number(attempt.penaltiesApplied || 0) +
        Number(config.tabPenalty || 0)
      ).toFixed(2)
    );


  attempt.violations.push({

    type:
      event.type,

    message:
      event.message || "",

    at:
      Date.now()
  });


  alertSecurity(
    `${event.message || "Suspicious activity"} · ` +
    `Violation ${attempt.violationCount}`
  );


  /*
     Replace current question
     when admin enabled the feature.
  */

  if (
    config.replaceQuestionOnSwitch !== false
  ) {

    const used =
      new Set(
        questions.map(q =>
          String(q.id)
        )
      );


    const candidate =
      shuffle(pool)
        .find(
          q =>
            !used.has(
              String(q.id)
            )
        );


    if (candidate) {

      const oldId =
        questions[current].id;


      delete attempt.answers[
        String(oldId)
      ];


      questions[current] =
        candidate;


      attempt.questionIds[current] =
        candidate.id;


      if (!attempt.questionSubjects) {
        attempt.questionSubjects = [];
      }


      attempt.questionSubjects[current] =
        candidate.__subject || "General";


      await sync({
        questionIds:
          attempt.questionIds,

        questionSubjects:
          attempt.questionSubjects
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
        Number(attempt.endsAt) -
        Date.now()
      );


    const minutes =
      Math.floor(
        left / 60000
      );


    const seconds =
      Math.floor(
        (left % 60000) / 1000
      );


    $("timer").textContent =
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`;


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
        String(question.id)
      ];


    const correctAnswer =
      question.a ??
      question.answer;


    if (answer === correctAnswer) {

      correct++;

    } else if (answer) {

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
          (Number(config.negativeMarking) || 0) -
        (attempt.penaltiesApplied || 0)
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
   SUBMIT EXAM
========================================================= */

async function submitExam(autoSubmitted) {

  if (submitting) return;


  submitting = true;


  clearInterval(timerHandle);

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


  const result = {

    ownerUid:
      auth.currentUser.uid,

    name:
      attempt.name,

    email:
      attempt.email,

    centerCode:
      attempt.centerCode ||
      config.centerCode ||
      "",

    examId:
      config.examId ||
      attempt.examId ||
      "current_test",

    exam:
      config.examTitle ||
      attempt.examTitle ||
      "TestHub Examination",

    examTitle:
      config.examTitle ||
      attempt.examTitle ||
      "TestHub Examination",

    instituteName:
      config.instituteName ||
      "TestHub",

    correct:
      calculated.correct,

    wrong:
      calculated.wrong,

    unanswered:
      calculated.unanswered,

    score:
      calculated.score,

    total:
      questions.length,

    answers:
      attempt.answers || {},

    questionIds:
      attempt.questionIds || [],

    questionSubjects:
      attempt.questionSubjects || [],

    tabSwitches:
      attempt.violations.filter(
        item =>
          tabTypes.includes(item.type)
      ).length,

    copiesAttempted:
      attempt.violations.filter(
        item =>
          copyTypes.includes(item.type)
      ).length,

    penaltiesApplied:
      attempt.penaltiesApplied || 0,

    violationCount:
      attempt.violationCount || 0,

    violations:
      attempt.violations || [],

    autoSubmitted:
      autoSubmitted,

    timeTakenSeconds:
      Math.round(
        (
          Date.now() -
          attempt.startedAt
        ) / 1000
      ),

    submittedAt:
      serverTimestamp()

  };


  /*
     Snapshot used by performance/download
     functions.
  */

  result.questionSnapshot =
    questions.map(
      (question, index) => ({

        number:
          index + 1,

        id:
          question.id,

        subject:
          question.__subject ||
          "General",

        question:
          question.q ??
          question.question,

        options:
          Array.isArray(question.options)
            ? question.options
            : [],

        correctAnswer:
          question.a ??
          question.answer,

        studentAnswer:
          attempt.answers?.[
            String(question.id)
          ] ||
          "Not answered"

      })
    );


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
          attempt.answers || {},

        resultSummary:
          calculated,

        submittedAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()

      }
    );


    if (document.fullscreenElement) {

      document
        .exitFullscreen()
        .catch(() => {});

    }


    showResult(result);


  } catch (error) {

    submitting = false;

    alert(
      "The result could not be submitted. " +
      "Check your internet connection and try again."
    );

  }

}


/* =========================================================
   RESULT SCREEN
========================================================= */

function showResult(result) {

  $("examView")
    .classList
    .add("hidden");


  $("resultView")
    .classList
    .remove("hidden");


  $("finalScore").textContent =
    `${result.score}/${result.total}`;


  $("accuracy").textContent =
    `${result.total
      ? Math.round(
          result.correct /
          result.total *
          100
        )
      : 0
    }%`;


  $("correctCount").textContent =
    result.correct;


  $("wrongCount").textContent =
    result.wrong;


  $("securitySummary").textContent =
    `Tab/fullscreen: ${result.tabSwitches} · ` +
    `Copy/other: ${result.copiesAttempted} · ` +
    `Penalty: ${result.penaltiesApplied}`;


  $("reviewLedger").innerHTML = "";


  questions.forEach(
    (question, index) => {

      const myAnswer =
        attempt.answers?.[
          String(question.id)
        ] ||
        "Not answered";


      const correctAnswer =
        question.a ??
        question.answer;


      const item =
        document.createElement("div");


      item.className =
        `ledger-item ${
          myAnswer === correctAnswer
            ? "ok"
            : myAnswer === "Not answered"
              ? ""
              : "bad"
        }`;


      item.textContent =
        `Q${index + 1}. ` +
        `${question.q ?? question.question} | ` +
        `Your answer: ${myAnswer} | ` +
        `Correct: ${correctAnswer}`;


      $("reviewLedger").append(item);

    }
  );


  /*
     Prevent duplicate stars if result screen
     is somehow reopened.
  */

  $("stars").innerHTML = "";


  for (let i = 1; i <= 5; i++) {

    const star =
      document.createElement("button");


    star.type = "button";
    star.className = "star";
    star.textContent = "★";


    star.onclick = () => {

      rating = i;


      document
        .querySelectorAll(".star")
        .forEach(
          (element, index) => {

            element.classList.toggle(
              "active",
              index < i
            );

          }
        );

    };


    $("stars").append(star);

  }


  /*
     Download buttons are created here,
     so index.html change is not required.
  */

  addResultDownloadButtons(result);

}


/* =========================================================
   DOWNLOAD BUTTONS
========================================================= */

function addResultDownloadButtons(result) {

  const container =
    $("resultView");


  if (
    container.querySelector(
      ".testhub-download-actions"
    )
  ) {
    return;
  }


  const wrapper =
    document.createElement("div");


  wrapper.className =
    "testhub-download-actions";


  wrapper.style.cssText = `
    display:flex;
    gap:10px;
    flex-wrap:wrap;
    margin:20px 0;
  `;


  const performanceButton =
    document.createElement("button");


  performanceButton.type = "button";
  performanceButton.className = "btn";
  performanceButton.textContent =
    "Download Performance Result";


  performanceButton.onclick =
    () => downloadPerformance(result);


  const questionsButton =
    document.createElement("button");


  questionsButton.type = "button";
  questionsButton.className = "btn";
  questionsButton.textContent =
    "Download Questions & Answers";


  questionsButton.onclick =
    () => downloadQuestions(result);


  wrapper.append(
    performanceButton,
    questionsButton
  );


  /*
     Put buttons near top of result page.
  */

  container.prepend(wrapper);

}


/* =========================================================
   TEXT ESCAPE
========================================================= */

function escText(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character])
  );

}


/* =========================================================
   CSV CELL
========================================================= */

function csvCell(value) {

  return `"${String(
    value ?? ""
  ).replaceAll('"', '""')}"`;

}


/* =========================================================
   DOWNLOAD BLOB
========================================================= */

function downloadBlob(
  content,
  filename,
  type
) {

  const url =
    URL.createObjectURL(
      new Blob(
        [content],
        { type }
      )
    );


  const anchor =
    document.createElement("a");


  anchor.href = url;
  anchor.download = filename;


  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();


  setTimeout(
    () =>
      URL.revokeObjectURL(url),
    500
  );

}


/* =========================================================
   PERFORMANCE RESULT DOWNLOAD
========================================================= */

function downloadPerformance(result) {

  const accuracy =
    result.total
      ? Math.round(
          result.correct /
          result.total *
          100
        )
      : 0;


  const questionRows =
    questions.map(
      (question, index) => {

        const studentAnswer =
          attempt.answers?.[
            String(question.id)
          ] ||
          "Not answered";


        const correctAnswer =
          question.a ??
          question.answer;


        const resultStatus =
          studentAnswer === correctAnswer
            ? "Correct"
            : studentAnswer === "Not answered"
              ? "Unanswered"
              : "Wrong";


        return `
          <div class="q">
            <div class="subject">
              ${escText(
                question.__subject ||
                "General"
              )}
            </div>

            <b>
              Q${index + 1}.
            </b>

            ${escText(
              question.q ??
              question.question
            )}

            <br>

            <span>
              Your answer:
            </span>

            ${escText(studentAnswer)}

            <br>

            <span>
              Correct answer:
            </span>

            ${escText(correctAnswer)}

            <br>

            <span>
              Result:
            </span>

            ${resultStatus}
          </div>
        `;
      }
    )
    .join("");


  const html = `
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
  Performance Result
</title>

<style>

body{
  font-family:Arial, sans-serif;
  padding:30px;
  color:#172033;
  line-height:1.5;
}

h1{
  margin-bottom:5px;
}

.meta{
  margin-bottom:25px;
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(4, minmax(120px,1fr));
  gap:12px;
}

.box{
  border:1px solid #ddd;
  padding:14px;
  border-radius:10px;
}

.q{
  padding:12px 0;
  border-bottom:1px solid #eee;
}

.subject{
  font-weight:bold;
  margin-bottom:5px;
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
  ${escText(
    result.examTitle ||
    config.examTitle ||
    "TestHub Examination"
  )}
</h1>

<div class="meta">

<b>Institute:</b>
${escText(
  result.instituteName ||
  config.instituteName ||
  "TestHub"
)}

<br>

<b>Student:</b>
${escText(result.name)}

<br>

<b>Email:</b>
${escText(result.email)}

<br>

<b>Center Code:</b>
${escText(
  result.centerCode || "-"
)}

<br>

<b>Exam ID:</b>
${escText(
  result.examId || "-"
)}

</div>


<div class="grid">

  <div class="box">
    <b>Score</b>
    <br>
    ${result.score}/${result.total}
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
  Security Summary
</h2>

<p>
  Tab/fullscreen:
  ${result.tabSwitches}
  <br>

  Copy/other:
  ${result.copiesAttempted}
  <br>

  Violations:
  ${result.violationCount}
  <br>

  Penalty:
  ${result.penaltiesApplied}
</p>


<h2>
  Question Performance
</h2>

${questionRows}

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
   QUESTIONS + ANSWERS DOWNLOAD
========================================================= */

function downloadQuestions() {

  const rows = [[
    "Question No",
    "Subject",
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Your Answer",
    "Correct Answer",
    "Result"
  ]];


  questions.forEach(
    (question, index) => {

      const myAnswer =
        attempt.answers?.[
          String(question.id)
        ] ||
        "Not answered";


      const correctAnswer =
        question.a ??
        question.answer;


      const resultStatus =
        myAnswer === correctAnswer
          ? "Correct"
          : myAnswer === "Not answered"
            ? "Unanswered"
            : "Wrong";


      rows.push([

        index + 1,

        question.__subject ||
          "General",

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

        myAnswer,

        correctAnswer,

        resultStatus

      ]);

    }
  );


  const csv =
    "\ufeff" +
    rows
      .map(
        row =>
          row
            .map(csvCell)
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
   FEEDBACK
========================================================= */

$("feedbackBtn").onclick =
  async () => {

    if (!rating) {

      $("feedbackMsg").textContent =
        "Rating required.";

      $("feedbackMsg").className =
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
            $("doubt").value.trim(),

          feedback:
            $("feedback").value.trim(),

          feedbackAt:
            serverTimestamp()

        }
      );


      $("feedbackMsg").textContent =
        "Feedback successfully saved.";

      $("feedbackMsg").className =
        "notice";


      $("feedbackBtn").disabled =
        true;


    } catch (error) {

      $("feedbackMsg").textContent =
        "Feedback save failed: " +
        error.message;

      $("feedbackMsg").className =
        "notice error";
    }

  };


/* =========================================================
   TEXT REPLACEMENTS
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
      .querySelectorAll("body *")
      .forEach(element => {

        if (
          element.children.length === 0 &&
          replacements[
            element.textContent.trim()
          ]
        ) {

          element.textContent =
            replacements[
              element.textContent.trim()
            ];

        }

      });

  }
);
