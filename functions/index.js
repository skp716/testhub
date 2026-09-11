
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
const LOCAL_QUESTION_BANK = require("./question_bank.json");

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
  if (snap.exists) {
    const data = snap.data();
    if (Array.isArray(data.questions) && data.questions.length) return data.questions;
  }
  if (Array.isArray(LOCAL_QUESTION_BANK) && LOCAL_QUESTION_BANK.length) return LOCAL_QUESTION_BANK;
  throw new HttpsError("failed-precondition", "Question bank is empty.");
}

// ─────────────────────────────────────────────
// Sanitize question for candidate
// ─────────────────────────────────────────────

function publicQuestion(question, index) {
  return {
    id: String(question.id || `q_${index + 1}`),
    number: index + 1,
    section: cleanString(question.section || "General", 100),
    question: cleanString(question.question ?? question.q ?? "", 10000),
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
  const email = cleanString(request.data?.email || auth.token.email || "", 250);
  const centerCode = cleanString(request.data?.centerCode, 150);
  const requestedAttemptId = cleanString(request.data?.attemptId, 150);

  if (!name || !email) throw new HttpsError("invalid-argument", "Candidate name and email are required.");

  const config = await getExamConfig();
  if (config.examActive === false || config.enabled === false) {
    throw new HttpsError("failed-precondition", "The examination is not currently active.");
  }

  if (config.centerCode && centerCode !== String(config.centerCode).trim()) {
    throw new HttpsError("permission-denied", "The Exam Center Code is incorrect.");
  }

  const now = Date.now();
  const windowStart = Number(config.windowStart || 0);
  const windowEnd = Number(config.windowEnd || 0);
  if (windowStart && now < windowStart) {
    throw new HttpsError("failed-precondition", `The exam will start on ${new Date(windowStart).toLocaleString("en-IN")}.`);
  }
  if (windowEnd && now > windowEnd) throw new HttpsError("failed-precondition", "The exam window has ended.");

  const attemptRef = requestedAttemptId ? getAttemptRef(requestedAttemptId) : db.collection("attempts").doc();
  const existing = await attemptRef.get();
  if (existing.exists) {
    const data = existing.data();
    validateAttemptOwnership(data, uid);
    if (data.status === "in_progress") {
      return { success: true, resumed: true, attemptId: attemptRef.id, examTitle: data.examTitle, durationMinutes: data.durationMinutes, startedAt: data.startedAt.toMillis(), endsAt: data.endsAt.toMillis(), questions: data.questions };
    }
    throw new HttpsError("already-exists", "You already have an examination attempt.");
  }

  const activeAttempts = await db.collection("attempts").where("ownerUid", "==", uid).limit(20).get();
  for (const item of activeAttempts.docs) {
    if (["in_progress", "submitted", "auto_submitted"].includes(item.data().status)) {
      throw new HttpsError("already-exists", "You already have an examination attempt.");
    }
  }

  let questions = await getQuestionBank();
  if (config.randomizeQuestions !== false) questions = shuffle(questions);
  const studentLimit = Number(config.studentLimit || questions.length);
  if (studentLimit > 0) questions = questions.slice(0, Math.min(studentLimit, questions.length));

  const durationMinutes = Math.max(1, Number(config.durationMinutes || 60));
  const startedAt = nowTimestamp();
  const endsAt = timestampFromMillis(Date.now() + durationMinutes * 60 * 1000);
  const publicQuestions = questions.map(publicQuestion);

  const attemptData = {
    ownerUid: uid, name, email, centerCode,
    examId: cleanString(config.examId || "current_test", 100),
    status: "in_progress",
    examTitle: cleanString(config.examTitle || config.title || DEFAULT_CONFIG.title, 200),
    questionIds: questions.map((q, index) => String(q.id || `q_${index + 1}`)),
    questionSubjects: questions.map(q => cleanString(q.__subject || q.subject || q.section || "General", 100)),
    questions: publicQuestions, answers: {}, review: [], violations: [],
    violationCount: 0, penaltiesApplied: 0, forceSubmitRequested: false,
    durationMinutes, startedAt, endsAt, lastSavedAt: startedAt, createdAt: startedAt, updatedAt: startedAt
  };

  await attemptRef.create(attemptData);
  return { success: true, resumed: false, attemptId: attemptRef.id, examTitle: attemptData.examTitle, durationMinutes, startedAt: startedAt.toMillis(), endsAt: endsAt.toMillis(), questions: publicQuestions };
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
    review: Array.isArray(attempt.review) ? attempt.review : [],
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
// SAVE ALL ANSWERS
// ─────────────────────────────────────────────
exports.saveAnswers = onCall(async (request) => {
  const auth = requireAuth(request);
  const attemptId = cleanString(request.data?.attemptId, 150);
  const incoming = request.data?.answers;
  if (!attemptId || !incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new HttpsError("invalid-argument", "Attempt ID and answers are required.");
  }

  const attemptRef = getAttemptRef(attemptId);
  const snap = await attemptRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Attempt not found.");
  const attempt = snap.data();
  validateAttemptOwnership(attempt, auth.uid);
  if (attempt.status !== "in_progress") throw new HttpsError("failed-precondition", "This attempt is no longer active.");
  if (isExpired(attempt.endsAt)) throw new HttpsError("deadline-exceeded", "The examination time has expired.");

  const allowed = new Set((attempt.questionIds || []).map(id => String(id)));
  const existing = { ...(attempt.answers || {}) };
  for (const [questionId, answer] of Object.entries(incoming).slice(0, 500)) {
    if (!allowed.has(String(questionId))) continue;
    existing[String(questionId)] = answer === null ? null : String(answer).slice(0, 200);
  }

  await attemptRef.update({ answers: existing, lastSavedAt: nowTimestamp(), updatedAt: nowTimestamp() });
  return { success: true, savedAt: Date.now() };
});

// ─────────────────────────────────────────────
// SAVE NAVIGATION STATE
// ─────────────────────────────────────────────

exports.saveNavigation = onCall(async (request) => {
  const auth = requireAuth(request);

  const attemptId = cleanString(request.data?.attemptId, 150);
  const currentIndex = Number(request.data?.currentIndex || 0);
  const review = Array.isArray(request.data?.review) ? request.data.review.map(value => String(value)).slice(0, 500) : [];
  const visited = request.data?.visited && typeof request.data.visited === "object" ? request.data.visited : {};

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
    currentIndex: Math.min(Math.max(0, Math.floor(currentIndex)), Math.max(0, (attempt.questions || []).length - 1)),
    review,
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
  const message = cleanString(request.data?.message, 300);
  if (!attemptId || !type) throw new HttpsError("invalid-argument", "Attempt ID and violation type are required.");

  const attemptRef = getAttemptRef(attemptId);
  const snap = await attemptRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Attempt not found.");
  const attempt = snap.data();
  validateAttemptOwnership(attempt, auth.uid);
  if (attempt.status !== "in_progress") return { success: false, alreadySubmitted: true };
  if (isExpired(attempt.endsAt)) return { success: false, expired: true, autoSubmit: true };

  const config = await getExamConfig();
  const now = nowTimestamp();
  const violationCount = Number(attempt.violationCount || 0) + 1;
  const penaltiesApplied = Number((Number(attempt.penaltiesApplied || 0) + Number(config.tabPenalty || 0)).toFixed(2));
  const maxViolations = Math.max(0, Number(config.maxTabSwitches ?? config.maxViolations ?? 3));
  const shouldAutoSubmit = maxViolations > 0 && violationCount >= maxViolations;
  const violations = Array.isArray(attempt.violations) ? [...attempt.violations] : [];
  violations.push({ type, message, at: now.toMillis() });
  const update = { violationCount, penaltiesApplied, violations: violations.slice(-100), lastViolationType: type, lastViolationAt: now, updatedAt: now };

  if (!shouldAutoSubmit && config.replaceQuestionOnSwitch !== false) {
    const bank = await getQuestionBank();
    const currentIndex = Math.min(Math.max(0, Number(attempt.currentIndex || 0)), Math.max(0, (attempt.questions || []).length - 1));
    const used = new Set((attempt.questionIds || []).map(id => String(id)));
    const candidates = bank.filter((q, i) => !used.has(String(q.id || `q_${i + 1}`)));
    const replacement = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    if (replacement && currentIndex < (attempt.questionIds || []).length) {
      const oldId = String(attempt.questionIds[currentIndex]);
      const questionIds = [...attempt.questionIds];
      questionIds[currentIndex] = String(replacement.id || `q_${currentIndex + 1}`);
      const publicQuestions = [...(attempt.questions || [])];
      publicQuestions[currentIndex] = publicQuestion(replacement, currentIndex);
      const answers = { ...(attempt.answers || {}) };
      delete answers[oldId];
      update.questionIds = questionIds;
      update.questions = publicQuestions;
      update.questionSubjects = (attempt.questionSubjects || []).map((v, i) => i === currentIndex ? cleanString(replacement.__subject || replacement.subject || replacement.section || "General", 100) : v);
      update.answers = answers;
      update.review = Array.isArray(attempt.review) ? attempt.review.filter(id => String(id) !== oldId) : [];
    }
  }

  await attemptRef.update(update);
  return { success: true, violationCount, penaltiesApplied, autoSubmit: shouldAutoSubmit };
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

    const correctAnswer = question.answer ?? question.a;

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

  const tabTypes = new Set(["tab-hidden", "window-blur", "fullscreen-exit", "viewport-change"]);
  const copyTypes = new Set(["copy", "cut", "paste", "context-menu", "print", "selection"]);
  const violationList = Array.isArray(attempt.violations) ? attempt.violations : [];
  const tabSwitches = violationList.filter(item => tabTypes.has(item.type)).length;
  const copiesAttempted = violationList.filter(item => copyTypes.has(item.type)).length;
  const questionMap = new Map(questionBank.map((q, i) => [String(q.id ?? `q_${i + 1}`), q]));

  const result = {
    attemptId,
    ownerUid: attempt.ownerUid,
    name: attempt.name,
    email: attempt.email,

    examId: attempt.examId || config.examId || "current_test",
    exam: attempt.examTitle,
    examTitle: attempt.examTitle,

    status: expired
      ? "auto_submitted"
      : "submitted",

    score: score.marksObtained,
    totalMarks: score.totalMarks,
    percentage: score.percentage,

    totalQuestions: score.totalQuestions,
    total: score.totalQuestions,
    correct: score.correct,
    wrong: score.wrong,
    unanswered: score.unanswered,

    violationCount: attempt.violationCount || 0,
    violations: Array.isArray(attempt.violations) ? attempt.violations.slice(-100) : [],
    penaltiesApplied: Number(attempt.penaltiesApplied || 0),
    forceSubmitted: Boolean(attempt.forceSubmitRequested),
    tabSwitches,
    copiesAttempted,

    startedAt: attempt.startedAt,
    submittedAt,

    createdAt: submittedAt
  };

  result.questionSnapshot = (attempt.questionIds || []).map((questionId, index) => {
    const q = questionMap.get(String(questionId));
    const publicQ = Array.isArray(attempt.questions) ? attempt.questions[index] : null;
    return {
      number: index + 1,
      id: String(questionId),
      subject: attempt.questionSubjects?.[index] || q?.section || q?.subject || "General",
      question: q?.question ?? q?.q ?? publicQ?.question ?? "",
      options: Array.isArray(q?.options) ? q.options : (Array.isArray(publicQ?.options) ? publicQ.options : []),
      correctAnswer: q?.answer ?? q?.a ?? null,
      studentAnswer: attempt.answers?.[String(questionId)] ?? "Not answered"
    };
  });

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
// ADMIN: FORCE SUBMIT ATTEMPT
// ─────────────────────────────────────────────
exports.forceSubmitAttempt = onCall(async (request) => {
  const auth = await requireAdmin(request);
  const attemptId = cleanString(request.data?.attemptId, 150);
  const reason = cleanString(request.data?.reason || "Submitted by administrator", 300);
  if (!attemptId) throw new HttpsError("invalid-argument", "Attempt ID is required.");
  const attemptRef = getAttemptRef(attemptId);
  const snap = await attemptRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Attempt not found.");
  if (snap.data().status !== "in_progress") throw new HttpsError("failed-precondition", "This attempt is no longer active.");
  await attemptRef.update({ forceSubmitRequested: true, forceSubmitReason: reason, forceSubmitRequestedAt: nowTimestamp(), forceSubmitRequestedBy: auth.uid, updatedAt: nowTimestamp() });
  return { success: true, attemptId };
});

// ─────────────────────────────────────────────
// SAVE STUDENT FEEDBACK
// ─────────────────────────────────────────────
exports.saveFeedback = onCall(async (request) => {
  const auth = requireAuth(request);
  const attemptId = cleanString(request.data?.attemptId, 150);
  const rating = Math.max(0, Math.min(5, Number(request.data?.rating || 0)));
  const doubt = cleanString(request.data?.doubt, 5000);
  const feedback = cleanString(request.data?.feedback, 5000);
  if (!attemptId || !rating) throw new HttpsError("invalid-argument", "Attempt ID and rating are required.");
  const resultRef = getResultRef(attemptId);
  const snap = await resultRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Result not found.");
  if (snap.data().ownerUid !== auth.uid) throw new HttpsError("permission-denied", "You are not allowed to update this result.");
  await resultRef.update({ rating, doubt, feedback, feedbackAt: nowTimestamp() });
  return { success: true };
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
