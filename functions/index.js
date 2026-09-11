
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10
});

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const CONFIG_PATH = "exam_config/current_test";
const QUESTION_BANK_PATH = "question_bank/current";

const DEFAULT_CONFIG = {
  title: "TestHub CBT Examination",
  durationMinutes: 60,
  marksPerQuestion: 1,
  negativeMarking: 0.25,
  maxViolations: 3,
  allowResume: true,
  randomizeQuestions: true,
  showResultImmediately: true
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Please sign in before starting the exam."
    );
  }

  return request.auth;
}

function cleanString(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function nowTimestamp() {
  return admin.firestore.Timestamp.now();
}

function timestampFromMillis(ms) {
  return admin.firestore.Timestamp.fromMillis(ms);
}

function isExpired(timestamp) {
  return timestamp && timestamp.toMillis() <= Date.now();
}

function getAttemptRef(attemptId) {
  return db.collection("attempts").doc(attemptId);
}

function getResultRef(attemptId) {
  return db.collection("results").doc(attemptId);
}

function validateAttemptOwnership(attempt, uid) {
  if (!attempt || attempt.ownerUid !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You are not allowed to access this attempt."
    );
  }
}

// ─────────────────────────────────────────────
// Admin helper
// ─────────────────────────────────────────────

async function isAdmin(uid) {
  const snap = await db.collection("admin").doc(uid).get();

  if (!snap.exists) return false;

  const data = snap.data();

  return data.active === true &&
    ["admin", "super_admin"].includes(data.role);
}

async function requireAdmin(request) {
  const auth = requireAuth(request);

  if (!(await isAdmin(auth.uid))) {
    throw new HttpsError(
      "permission-denied",
      "Admin access required."
    );
  }

  return auth;
}

// ─────────────────────────────────────────────
// Read exam configuration
// ─────────────────────────────────────────────

async function getExamConfig() {
  const snap = await db.doc(CONFIG_PATH).get();

  if (!snap.exists) {
    return DEFAULT_CONFIG;
  }

  return {
    ...DEFAULT_CONFIG,
    ...snap.data()
  };
}

// ─────────────────────────────────────────────
// Read question bank
// ─────────────────────────────────────────────

async function getQuestionBank() {
  const snap = await db.doc(QUESTION_BANK_PATH).get();

  if (!snap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Question bank is not configured."
    );
  }

  const data = snap.data();

  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Question bank is empty."
    );
  }

  return data.questions;
}

// ─────────────────────────────────────────────
// Sanitize question for candidate
// ─────────────────────────────────────────────

function publicQuestion(question, index) {
  return {
    id: String(question.id || `q_${index + 1}`),
    number: index + 1,
    section: cleanString(question.section || "General", 100),
    question: cleanString(question.question, 10000),
    options: Array.isArray(question.options)
      ? question.options.map(option => cleanString(option, 2000))
      : [],
    marks: Number(question.marks || 1)
  };
}

// ─────────────────────────────────────────────
// START EXAM
// ─────────────────────────────────────────────

exports.startExam = onCall(async (request) => {
  const auth = requireAuth(request);
  const uid = auth.uid;

  const name = cleanString(request.data?.name, 150);
  const email = cleanString(
    request.data?.email || auth.token.email || "",
    250
  );

  if (!name) {
    throw new HttpsError(
      "invalid-argument",
      "Candidate name is required."
    );
  }

  const config = await getExamConfig();

  if (config.enabled === false) {
    throw new HttpsError(
      "failed-precondition",
      "The examination is not currently active."
    );
  }

  // One active/completed attempt per user.
  const existingSnap = await db.collection("attempts")
    .where("ownerUid", "==", uid)
    .limit(10)
    .get();

  for (const doc of existingSnap.docs) {
    const existing = doc.data();

    if (
      existing.status === "in_progress" ||
      existing.status === "submitted" ||
      existing.status === "auto_submitted"
    ) {
      throw new HttpsError(
        "already-exists",
        "You already have an examination attempt."
      );
    }
  }

  let questions = await getQuestionBank();

  if (config.randomizeQuestions !== false) {
    questions = shuffle(questions);
  }

  const durationMinutes = Math.max(
    1,
    Number(config.durationMinutes || 60)
  );

  const startedAt = nowTimestamp();
  const endsAt = timestampFromMillis(
    Date.now() + durationMinutes * 60 * 1000
  );

  const attemptRef = db.collection("attempts").doc();

  const attemptData = {
    ownerUid: uid,
    name,
    email,

    status: "in_progress",

    examTitle: cleanString(
      config.title || DEFAULT_CONFIG.title,
      200
    ),

    questionIds: questions.map((q, index) =>
      String(q.id || `q_${index + 1}`)
    ),

    questions: questions.map(publicQuestion),

    answers: {},
    markedForReview: {},
    visited: {},

    currentIndex: 0,
    violationCount: 0,

    durationMinutes,
    startedAt,
    endsAt,
    lastSavedAt: startedAt,

    createdAt: startedAt,
    updatedAt: startedAt
  };

  await attemptRef.set(attemptData);

  return {
    success: true,
    attemptId: attemptRef.id,
    examTitle: attemptData.examTitle,
    durationMinutes,
    startedAt: startedAt.toMillis(),
    endsAt: endsAt.toMillis(),
    questions: attemptData.questions
  };
});

// ─────────────────────────────────────────────
// GET / RESUME EXAM
// ─────────────────────────────────────────────

exports.getAttempt = onCall(async (request) => {
  const auth = requireAuth(request);
  const attemptId = cleanString(request.data?.attemptId, 150);

  if (!attemptId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID is required."
    );
  }

  const snap = await getAttemptRef(attemptId).get();

  if (!snap.exists) {
    throw new HttpsError(
      "not-found",
      "Attempt not found."
    );
  }

  const attempt = snap.data();

  validateAttemptOwnership(attempt, auth.uid);

  if (attempt.status !== "in_progress") {
    throw new HttpsError(
      "failed-precondition",
      "This attempt is no longer active."
    );
  }

  if (isExpired(attempt.endsAt)) {
    throw new HttpsError(
      "deadline-exceeded",
      "The examination time has expired."
    );
  }

  return {
    success: true,
    attemptId,
    examTitle: attempt.examTitle,
    questions: attempt.questions,
    answers: attempt.answers || {},
    markedForReview: attempt.markedForReview || {},
    visited: attempt.visited || {},
    currentIndex: attempt.currentIndex || 0,
    violationCount: attempt.violationCount || 0,
    startedAt: attempt.startedAt.toMillis(),
    endsAt: attempt.endsAt.toMillis()
  };
});

// ─────────────────────────────────────────────
// SAVE ANSWER
// ─────────────────────────────────────────────

exports.saveAnswer = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);
  const questionId = cleanString(request.data?.questionId, 150);
  const answer = request.data?.answer;

  if (!attemptId || !questionId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID and question ID are required."
    );
  }

  const attemptRef = getAttemptRef(attemptId);
  const snap = await attemptRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Attempt not found.");
  }

  const attempt = snap.data();

  validateAttemptOwnership(attempt, auth.uid);

  if (attempt.status !== "in_progress") {
    throw new HttpsError(
      "failed-precondition",
      "This attempt is no longer active."
    );
  }

  if (isExpired(attempt.endsAt)) {
    throw new HttpsError(
      "deadline-exceeded",
      "The examination time has expired."
    );
  }

  const questionExists = (attempt.questionIds || []).includes(questionId);

  if (!questionExists) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid question ID."
    );
  }

  const updatedAnswers = {
    ...(attempt.answers || {}),
    [questionId]: answer === null ? null : answer
  };

  await attemptRef.update({
    answers: updatedAnswers,
    lastSavedAt: nowTimestamp(),
    updatedAt: nowTimestamp()
  });

  return {
    success: true,
    savedAt: Date.now()
  };
});

// ─────────────────────────────────────────────
// SAVE NAVIGATION STATE
// ─────────────────────────────────────────────

exports.saveNavigation = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);
  const currentIndex = Number(request.data?.currentIndex || 0);
  const markedForReview = request.data?.markedForReview || {};
  const visited = request.data?.visited || {};

  if (!attemptId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID is required."
    );
  }

  const snap = await getAttemptRef(attemptId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Attempt not found.");
  }

  const attempt = snap.data();

  validateAttemptOwnership(attempt, auth.uid);

  if (attempt.status !== "in_progress") {
    throw new HttpsError(
      "failed-precondition",
      "This attempt is no longer active."
    );
  }

  if (isExpired(attempt.endsAt)) {
    throw new HttpsError(
      "deadline-exceeded",
      "The examination time has expired."
    );
  }

  await getAttemptRef(attemptId).update({
    currentIndex: Math.max(0, Math.floor(currentIndex)),
    markedForReview,
    visited,
    lastSavedAt: nowTimestamp(),
    updatedAt: nowTimestamp()
  });

  return {
    success: true,
    savedAt: Date.now()
  };
});

// ─────────────────────────────────────────────
// RECORD SECURITY VIOLATION
// ─────────────────────────────────────────────

exports.recordViolation = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);
  const type = cleanString(request.data?.type, 100);

  if (!attemptId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID is required."
    );
  }

  const attemptRef = getAttemptRef(attemptId);
  const snap = await attemptRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Attempt not found.");
  }

  const attempt = snap.data();

  validateAttemptOwnership(attempt, auth.uid);

  if (attempt.status !== "in_progress") {
    return {
      success: false,
      alreadySubmitted: true
    };
  }

  const config = await getExamConfig();

  const violationCount = Number(attempt.violationCount || 0) + 1;
  const maxViolations = Math.max(
    0,
    Number(config.maxViolations ?? 3)
  );

  const shouldAutoSubmit =
    maxViolations > 0 && violationCount >= maxViolations;

  await attemptRef.update({
    violationCount,
    lastViolationType: type,
    lastViolationAt: nowTimestamp(),
    updatedAt: nowTimestamp()
  });

  if (shouldAutoSubmit) {
    return {
      success: true,
      violationCount,
      autoSubmit: true
    };
  }

  return {
    success: true,
    violationCount,
    autoSubmit: false
  };
});

// ─────────────────────────────────────────────
// FINAL SCORING
// ─────────────────────────────────────────────

function calculateScore(attempt, questionBank, config) {
  const answers = attempt.answers || {};

  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  let marksObtained = 0;

  const marksPerQuestion = Number(
    config.marksPerQuestion || 1
  );

  const negativeMarking = Number(
    config.negativeMarking || 0
  );

  const questionMap = new Map();

  for (const question of questionBank) {
    questionMap.set(
      String(question.id),
      question
    );
  }

  for (const questionId of attempt.questionIds || []) {
    const question = questionMap.get(String(questionId));

    if (!question) continue;

    const selected = answers[questionId];

    if (
      selected === null ||
      selected === undefined ||
      selected === ""
    ) {
      unanswered++;
      continue;
    }

    const correctAnswer = question.answer;

    const isCorrect =
      String(selected) === String(correctAnswer);

    if (isCorrect) {
      correct++;
      marksObtained += Number(
        question.marks ?? marksPerQuestion
      );
    } else {
      wrong++;
      marksObtained -= negativeMarking;
    }
  }

  const totalQuestions = (attempt.questionIds || []).length;
  const totalMarks = totalQuestions * marksPerQuestion;

  return {
    totalQuestions,
    correct,
    wrong,
    unanswered,
    marksObtained: Math.max(0, Number(marksObtained.toFixed(2))),
    totalMarks,
    percentage: totalMarks > 0
      ? Number(
          ((Math.max(0, marksObtained) / totalMarks) * 100)
            .toFixed(2)
        )
      : 0
  };
}

// ─────────────────────────────────────────────
// SUBMIT EXAM
// ─────────────────────────────────────────────

exports.submitExam = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);

  if (!attemptId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID is required."
    );
  }

  const attemptRef = getAttemptRef(attemptId);
  const resultRef = getResultRef(attemptId);

  const snap = await attemptRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Attempt not found.");
  }

  const attempt = snap.data();

  validateAttemptOwnership(attempt, auth.uid);

  // Idempotent submit: return existing result.
  if (
    attempt.status === "submitted" ||
    attempt.status === "auto_submitted"
  ) {
    const existingResult = await resultRef.get();

    if (existingResult.exists) {
      return {
        success: true,
        alreadySubmitted: true,
        result: existingResult.data()
      };
    }

    throw new HttpsError(
      "failed-precondition",
      "Attempt is already submitted."
    );
  }

  const config = await getExamConfig();
  const questionBank = await getQuestionBank();

  const expired = isExpired(attempt.endsAt);

  const score = calculateScore(
    attempt,
    questionBank,
    config
  );

  const submittedAt = nowTimestamp();

  const result = {
    attemptId,
    ownerUid: attempt.ownerUid,
    name: attempt.name,
    email: attempt.email,

    examTitle: attempt.examTitle,

    status: expired
      ? "auto_submitted"
      : "submitted",

    score: score.marksObtained,
    totalMarks: score.totalMarks,
    percentage: score.percentage,

    totalQuestions: score.totalQuestions,
    correct: score.correct,
    wrong: score.wrong,
    unanswered: score.unanswered,

    violationCount: attempt.violationCount || 0,

    startedAt: attempt.startedAt,
    submittedAt,

    createdAt: submittedAt
  };

  // Transaction prevents duplicate finalization.
  await db.runTransaction(async (transaction) => {
    const latestAttempt = await transaction.get(attemptRef);

    if (!latestAttempt.exists) {
      throw new HttpsError("not-found", "Attempt not found.");
    }

    const latestData = latestAttempt.data();

    if (
      latestData.status === "submitted" ||
      latestData.status === "auto_submitted"
    ) {
      return;
    }

    transaction.set(resultRef, result);
    transaction.update(attemptRef, {
      status: result.status,
      submittedAt,
      updatedAt: submittedAt
    });
  });

  return {
    success: true,
    alreadySubmitted: false,
    result
  };
});

// ─────────────────────────────────────────────
// GET RESULT
// ─────────────────────────────────────────────

exports.getResult = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);

  if (!attemptId) {
    throw new HttpsError(
      "invalid-argument",
      "Attempt ID is required."
    );
  }

  const snap = await getResultRef(attemptId).get();

  if (!snap.exists) {
    throw new HttpsError(
      "not-found",
      "Result not found."
    );
  }

  const result = snap.data();

  if (result.ownerUid !== auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "You are not allowed to view this result."
    );
  }

  return {
    success: true,
    result
  };
});

// ─────────────────────────────────────────────
// ADMIN: SAVE EXAM CONFIG
// ─────────────────────────────────────────────

exports.saveExamConfig = onCall(async (request) => {
  await requireAdmin(request);

  const incoming = request.data?.config;

  if (!incoming || typeof incoming !== "object") {
    throw new HttpsError(
      "invalid-argument",
      "Configuration object is required."
    );
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...incoming,
    updatedAt: nowTimestamp()
  };

  await db.doc(CONFIG_PATH).set(config, { merge: true });

  return {
    success: true,
    config
  };
});

// ─────────────────────────────────────────────
// ADMIN: GET ALL RESULTS
// ─────────────────────────────────────────────

exports.getAllResults = onCall(async (request) => {
  await requireAdmin(request);

  const snap = await db.collection("results")
    .orderBy("submittedAt", "desc")
    .limit(500)
    .get();

  return {
    success: true,
    results: snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
  };
});
