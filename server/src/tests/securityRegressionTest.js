import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import authRoutes, {
  setGoogleTokenVerifierForTests,
  verifyGoogleTokenWithOfficialLibrary,
} from "../routes/authRoutes.js";
import itemRoutes from "../routes/itemRoutes.js";
import adminRoutes from "../routes/adminRoutes.js";
import claimRoutes from "../routes/claimRoutes.js";
import rewardRoutes from "../routes/rewardRoutes.js";
import notificationRoutes from "../routes/notificationRoutes.js";
import User from "../models/User.js";
import Item from "../models/Item.js";
import Claim from "../models/Claim.js";
import RewardEvent from "../models/RewardEvent.js";
import Notification from "../models/Notification.js";
import {
  findMatchesForItem,
  scoreItemPair,
} from "../utils/matchingEngine.js";
import {
  awardReportCreationXp,
  awardVerifiedReturnXp,
  reconcileUserRewards,
  recordRewardEvent,
} from "../utils/rewardEngine.js";
import {
  createNotificationIfNotExists,
  notifyClaimReviewed,
  notifyClaimSubmitted,
} from "../utils/notificationService.js";
import {
  apiNotFoundHandler,
  createRateLimiter,
  securityHeaders,
} from "../middleware/securityMiddleware.js";

dotenv.config({ quiet: true });

function createTestApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/items", itemRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/claims", claimRoutes);
  app.use("/api/rewards", rewardRoutes);
  app.use("/api/notifications", notificationRoutes);

  const testLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 3,
    message: "Too many test requests, please try again later.",
  });
  app.get("/api/test-rate-limit", testLimiter, (req, res) => {
    res.json({ success: true });
  });

  app.use("/api", apiNotFoundHandler);

  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({
        success: false,
        message: "Invalid JSON payload",
      });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({
        success: false,
        message: "Request payload too large",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  });

  return app;
}

async function apiRequest(baseUrl, path, { method = "GET", token, body, rawBody } = {}) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined || rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: text };
  }

  return { status: response.status, headers: response.headers, data, text };
}

async function runTests() {
  const results = [];
  const createdUserIds = [];
  const createdItemIds = [];
  const createdClaimIds = [];
  let server = null;

  function record(id, name, passed, statusObserved, details = "") {
    results.push({
      id,
      name,
      outcome: passed ? "PASS" : "FAIL",
      statusObserved,
      details,
    });
  }

  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    console.log("BLOCKED: Missing MONGODB_URI or JWT_SECRET in server/.env");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "smartcampus",
      serverSelectionTimeoutMS: 10000,
    });

    const app = createTestApp();
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const TEST_GOOGLE_CLIENT_ID =
      process.env.GOOGLE_CLIENT_ID ||
      "test-google-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;

    const testGoogleTokens = new Map();
    function createTestGoogleCredential(opts = {}) {
      const credId = `simulated-google-token-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      testGoogleTokens.set(credId, {
        iss: opts.iss !== undefined ? opts.iss : "https://accounts.google.com",
        aud: opts.aud !== undefined ? opts.aud : TEST_GOOGLE_CLIENT_ID,
        sub: opts.sub || `google-sub-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        email: opts.email,
        email_verified: opts.email_verified !== undefined ? opts.email_verified : true,
        name: opts.name || "Test Student",
      });
      return credId;
    }

    setGoogleTokenVerifierForTests(async (token, clientId) => {
      if (testGoogleTokens.has(token)) {
        return testGoogleTokens.get(token);
      }
      return await verifyGoogleTokenWithOfficialLibrary(token, clientId);
    });

    const runTag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const studentAEmail = `sec-student-a-${runTag}@test.lostlink.local`;
    const studentBEmail = `sec-student-b-${runTag}@test.lostlink.local`;
    const adminEmail = `sec-admin-${runTag}@test.lostlink.local`;
    const testPassword = "SafeTestPass#2026";

    // Case 1: Google sign-in with normal student data succeeds
    const credA = createTestGoogleCredential({
      email: studentAEmail,
      name: "Test Student A",
    });
    const regA = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: credA },
    });
    if (regA.data?.user?.id) createdUserIds.push(regA.data.user.id);
    record(
      1,
      "Google sign-in succeeds with role='student' and issues JWT",
      regA.status === 200 &&
        regA.data?.success === true &&
        regA.data?.user?.role === "student" &&
        regA.data?.user?.email === studentAEmail &&
        Boolean(regA.data?.token),
      regA.status
    );

    const tokenA = regA.data?.token;

    // Case 2: Google sign-in attempts with role: "admin" and isAdmin: true do not grant admin access
    const credB = createTestGoogleCredential({
      email: studentBEmail,
      name: "Test Student B",
    });
    const regB = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: {
        credential: credB,
        role: "admin",
        isAdmin: true,
      },
    });
    if (regB.data?.user?.id) createdUserIds.push(regB.data.user.id);
    const dbUserB = await User.findById(regB.data?.user?.id).select("role");
    record(
      2,
      "Google sign-in with role='admin' & isAdmin=true forces role='student'",
      regB.status === 200 &&
        regB.data?.user?.role === "student" &&
        dbUserB?.role === "student",
      regB.status
    );

    const tokenB = regB.data?.token;

    // Create dedicated test admin user and promote only that test user in DB
    const credAdmin = createTestGoogleCredential({
      email: adminEmail,
      name: "Test Admin",
    });
    const regAdmin = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: credAdmin },
    });
    if (regAdmin.data?.user?.id) {
      createdUserIds.push(regAdmin.data.user.id);
      await User.updateOne(
        { _id: regAdmin.data.user.id },
        { $set: { role: "admin" } }
      );
    }
    const tokenAdmin = regAdmin.data?.token;

    // Case 3: Unauthenticated access to protected endpoints returns HTTP 401
    const unauthMe = await apiRequest(baseUrl, "/api/auth/me");
    const unauthMine = await apiRequest(baseUrl, "/api/items/mine");
    const unauthPost = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      body: { title: "X" },
    });
    const unauthAdmin = await apiRequest(baseUrl, "/api/admin/items");
    record(
      3,
      "Unauthenticated access to protected & admin endpoints returns 401",
      unauthMe.status === 401 &&
        unauthMine.status === 401 &&
        unauthPost.status === 401 &&
        unauthAdmin.status === 401,
      `${unauthMe.status}/${unauthMine.status}/${unauthPost.status}/${unauthAdmin.status}`
    );

    // Case 4: A student accessing admin endpoints receives HTTP 403
    const studentAdminList = await apiRequest(baseUrl, "/api/admin/items", {
      token: tokenA,
    });
    const studentAdminStatus = await apiRequest(
      baseUrl,
      `/api/admin/items/${new mongoose.Types.ObjectId()}/status`,
      {
        method: "PATCH",
        token: tokenA,
        body: { status: "CLOSED" },
      }
    );
    const studentAdminDelete = await apiRequest(
      baseUrl,
      `/api/admin/items/${new mongoose.Types.ObjectId()}`,
      {
        method: "DELETE",
        token: tokenB,
      }
    );
    record(
      4,
      "Student accessing admin endpoints receives HTTP 403",
      studentAdminList.status === 403 &&
        studentAdminStatus.status === 403 &&
        studentAdminDelete.status === 403,
      `${studentAdminList.status}/${studentAdminStatus.status}/${studentAdminDelete.status}`
    );

    // Case 5: An authorized admin can access permitted admin endpoints
    const adminListRes = await apiRequest(baseUrl, "/api/admin/items?limit=5", {
      token: tokenAdmin,
    });
    const adminMeRes = await apiRequest(baseUrl, "/api/auth/me", {
      token: tokenAdmin,
    });
    record(
      5,
      "Authorized admin can access /api/admin/items and has verified role='admin'",
      adminListRes.status === 200 &&
        adminListRes.data?.success === true &&
        Array.isArray(adminListRes.data?.items) &&
        adminMeRes.status === 200 &&
        adminMeRes.data?.user?.role === "admin",
      `${adminListRes.status}/${adminMeRes.status}`
    );

    // Case 6: Invalid, malformed, or expired JWTs are rejected (401)
    const malformedRes = await apiRequest(baseUrl, "/api/auth/me", {
      token: "not.a.valid.jwt",
    });
    const wrongSecretToken = jwt.sign(
      { sub: regA.data.user.id },
      "wrong-secret-key-for-test",
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const wrongSigRes = await apiRequest(baseUrl, "/api/auth/me", {
      token: wrongSecretToken,
    });
    const expiredToken = jwt.sign(
      { sub: regA.data.user.id },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: -10 }
    );
    const expiredRes = await apiRequest(baseUrl, "/api/auth/me", {
      token: expiredToken,
    });
    const badSubToken = jwt.sign(
      { sub: "not-an-object-id" },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const badSubRes = await apiRequest(baseUrl, "/api/auth/me", {
      token: badSubToken,
    });
    record(
      6,
      "Invalid, wrong-signature, expired, and bad-sub JWTs return 401",
      malformedRes.status === 401 &&
        wrongSigRes.status === 401 &&
        expiredRes.status === 401 &&
        badSubRes.status === 401,
      `${malformedRes.status}/${wrongSigRes.status}/${expiredRes.status}/${badSubRes.status}`
    );

    // Case 7: /api/auth/me returns safe user data without password hashes or googleId
    const meARes = await apiRequest(baseUrl, "/api/auth/me", {
      token: tokenA,
    });
    const hasNoSensitiveFields =
      meARes.data?.user &&
      !("passwordHash" in meARes.data.user) &&
      !("password" in meARes.data.user) &&
      !("googleId" in meARes.data.user) &&
      !regA.text.includes("passwordHash") &&
      !regA.text.includes("googleId") &&
      !meARes.text.includes("passwordHash") &&
      !meARes.text.includes("googleId");
    record(
      7,
      "/api/auth/me and auth responses never expose passwordHash or googleId",
      meARes.status === 200 &&
        meARes.data?.user?.email === studentAEmail &&
        meARes.data?.user?.role === "student" &&
        hasNoSensitiveFields,
      meARes.status
    );

    // Create two test reports owned by Student A
    const createItem1 = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `Test Calculator ${runTag}`,
        description: "Scientific calculator for security test",
        category: "Electronics",
        type: "LOST",
        location: "Main Hall",
        itemDate: new Date().toISOString(),
        status: "RETURNED", // Attempt mass-assigning restricted status on create
      },
    });
    const item1Id = createItem1.data?.item?._id;
    if (item1Id) createdItemIds.push(item1Id);

    const createItem2 = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `Test Notebook ${runTag}`,
        description: "Blue spiral notebook for moderation test",
        category: "Books",
        type: "FOUND",
        location: "Library",
        itemDate: new Date().toISOString(),
      },
    });
    const item2Id = createItem2.data?.item?._id;
    if (item2Id) createdItemIds.push(item2Id);

    // Case 8: A student cannot edit or delete another student's report
    const crossEdit = await apiRequest(baseUrl, `/api/items/${item1Id}`, {
      method: "PATCH",
      token: tokenB,
      body: { title: "Hijacked Title" },
    });
    const crossDelete = await apiRequest(baseUrl, `/api/items/${item1Id}`, {
      method: "DELETE",
      token: tokenB,
    });
    record(
      8,
      "Student B cannot edit or delete Student A's report (404)",
      crossEdit.status === 404 && crossDelete.status === 404,
      `${crossEdit.status}/${crossDelete.status}`
    );

    // Case 9: A report owner can perform only allowed operations (cannot overwrite status or reportedBy)
    const ownerEdit = await apiRequest(baseUrl, `/api/items/${item1Id}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        title: `Updated Calculator ${runTag}`,
        status: "RETURNED",
        reportedBy: regB.data.user.id,
        moderated: true,
      },
    });
    record(
      9,
      "Owner can update allowed fields on OPEN report; restricted fields (status, reportedBy, moderated) are ignored",
      ownerEdit.status === 200 &&
        ownerEdit.data?.item?.title === `Updated Calculator ${runTag}` &&
        ownerEdit.data?.item?.status === "OPEN" &&
        ownerEdit.data?.item?.reportedBy === regA.data.user.id &&
        ownerEdit.data?.item?.moderated === false,
      ownerEdit.status
    );

    // Case 10: Closed or otherwise restricted reports cannot bypass ownership or status rules
    const adminCloseItem1 = await apiRequest(
      baseUrl,
      `/api/admin/items/${item1Id}/status`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "CLOSED" },
      }
    );
    const ownerEditClosed = await apiRequest(
      baseUrl,
      `/api/items/${item1Id}`,
      {
        method: "PATCH",
        token: tokenA,
        body: { title: "Should Fail Because Closed" },
      }
    );
    const ownerDeleteClosed = await apiRequest(
      baseUrl,
      `/api/items/${item1Id}`,
      {
        method: "DELETE",
        token: tokenA,
      }
    );
    const invalidTransition = await apiRequest(
      baseUrl,
      `/api/admin/items/${item1Id}/status`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "MATCHED" }, // CLOSED only allows transition to OPEN
      }
    );
    record(
      10,
      "Closed report blocks owner PATCH/DELETE (409) and blocks disallowed admin transition CLOSED->MATCHED (409)",
      adminCloseItem1.status === 200 &&
        ownerEditClosed.status === 409 &&
        ownerDeleteClosed.status === 409 &&
        invalidTransition.status === 409,
      `${adminCloseItem1.status}/${ownerEditClosed.status}/${ownerDeleteClosed.status}/${invalidTransition.status}`
    );

    // Reopen item1 as admin, then verify owner can delete their own OPEN report
    const adminReopenItem1 = await apiRequest(
      baseUrl,
      `/api/admin/items/${item1Id}/status`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "OPEN" },
      }
    );

    // Case 11: Invalid report IDs and invalid status values are rejected (400)
    const badIdPatch = await apiRequest(baseUrl, "/api/items/not-a-valid-id", {
      method: "PATCH",
      token: tokenA,
      body: { title: "Valid" },
    });
    const badIdAdminGet = await apiRequest(
      baseUrl,
      "/api/admin/items/not-a-valid-id",
      {
        token: tokenAdmin,
      }
    );
    const badStatusAdminPatch = await apiRequest(
      baseUrl,
      `/api/admin/items/${item2Id}/status`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "ARCHIVED_INVALID" },
      }
    );
    const badStatusAdminFilter = await apiRequest(
      baseUrl,
      "/api/admin/items?status=NOT_REAL",
      {
        token: tokenAdmin,
      }
    );
    record(
      11,
      "Invalid ObjectIds and invalid status values return HTTP 400",
      badIdPatch.status === 400 &&
        badIdAdminGet.status === 400 &&
        badStatusAdminPatch.status === 400 &&
        badStatusAdminFilter.status === 400,
      `${badIdPatch.status}/${badIdAdminGet.status}/${badStatusAdminPatch.status}/${badStatusAdminFilter.status}`
    );

    // Case 12: Public listings exclude moderated reports
    const moderateItem2 = await apiRequest(
      baseUrl,
      `/api/admin/items/${item2Id}`,
      {
        method: "DELETE",
        token: tokenAdmin,
        body: { reason: "Security test moderation removal" },
      }
    );
    const publicListAfterMod = await apiRequest(baseUrl, "/api/items");
    const item2InPublic = (publicListAfterMod.data?.items || []).some(
      (i) => i._id === item2Id
    );
    const adminGetItem2 = await apiRequest(
      baseUrl,
      `/api/admin/items/${item2Id}`,
      {
        token: tokenAdmin,
      }
    );
    record(
      12,
      "Moderated report is hidden from public GET /api/items but preserved for admin audit",
      moderateItem2.status === 200 &&
        publicListAfterMod.status === 200 &&
        !item2InPublic &&
        adminGetItem2.status === 200 &&
        adminGetItem2.data?.item?.moderated === true,
      `${moderateItem2.status}/${publicListAfterMod.status}/${adminGetItem2.status}`
    );

    // Case 13: Existing public listing, My Reports, Google login, disabled password login rejection (403), and owner delete continue working
    const disabledLoginRes = await apiRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: studentAEmail, password: testPassword },
    });
    const reauthCredA = createTestGoogleCredential({
      email: studentAEmail,
      name: "Test Student A",
    });
    const loginARes = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: reauthCredA },
    });
    const myReportsRes = await apiRequest(baseUrl, "/api/items/mine", {
      token: loginARes.data?.token,
    });
    const item1InMine = (myReportsRes.data?.items || []).some(
      (i) => i._id === item1Id
    );
    const ownerDeleteOpen = await apiRequest(
      baseUrl,
      `/api/items/${item1Id}`,
      {
        method: "DELETE",
        token: loginARes.data?.token,
      }
    );
    record(
      13,
      "Regression: Disabled password login returns 403, Google re-auth succeeds, My Reports (/api/items/mine), and owner OPEN delete succeed",
      adminReopenItem1.status === 200 &&
        disabledLoginRes.status === 403 &&
        loginARes.status === 200 &&
        myReportsRes.status === 200 &&
        item1InMine &&
        ownerDeleteOpen.status === 200,
      `${disabledLoginRes.status}/${loginARes.status}/${myReportsRes.status}/${ownerDeleteOpen.status}`
    );

    // Case 14: Unexpected/malformed payloads do not expose stack traces, secrets, or sensitive DB info
    const malformedJsonRes = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      rawBody: '{"credential": "broken-json',
    });
    const invalidDateItemRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: "Bad Date Item",
        description: "Testing CastError handling",
        category: "Other",
        type: "LOST",
        location: "Quad",
        itemDate: "not-a-valid-date",
      },
    });
    const leaksStackOrSecret =
      malformedJsonRes.text.includes("SyntaxError") ||
      malformedJsonRes.text.includes("at ") ||
      invalidDateItemRes.text.includes("CastError") ||
      invalidDateItemRes.text.includes("mongodb");
    record(
      14,
      "Malformed JSON and invalid field types return 400 JSON without stack traces or DB leaks",
      malformedJsonRes.status === 400 &&
        malformedJsonRes.data?.success === false &&
        invalidDateItemRes.status === 400 &&
        invalidDateItemRes.data?.success === false &&
        !leaksStackOrSecret,
      `${malformedJsonRes.status}/${invalidDateItemRes.status}`
    );

    // ── Phase 3: Search, Filters, Sorting & Pagination Tests ──────────────

    // Create 3 dedicated Phase 3 test items with distinct dates, categories, and regex chars
    const p3ItemA = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P3-Alpha [C++] Guide ${runTag}`,
        description: `Special regex chars (calc)* for ${runTag}`,
        category: "Books",
        type: "LOST",
        location: "North Science Wing",
        itemDate: "2026-01-10T00:00:00.000Z",
      },
    });
    const p3IdA = p3ItemA.data?.item?._id;
    if (p3IdA) createdItemIds.push(p3IdA);

    const p3ItemB = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P3-Beta Silver Keychain ${runTag}`,
        description: `Found near cafeteria entrance ${runTag}`,
        category: "Keys",
        type: "FOUND",
        location: "Central Cafeteria",
        itemDate: "2026-02-15T00:00:00.000Z",
      },
    });
    const p3IdB = p3ItemB.data?.item?._id;
    if (p3IdB) createdItemIds.push(p3IdB);

    const p3ItemC = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P3-Gamma USB Drive ${runTag}`,
        description: `Black 64GB drive ${runTag}`,
        category: "Electronics",
        type: "LOST",
        location: "North Science Wing",
        itemDate: "2026-03-20T00:00:00.000Z",
      },
    });
    const p3IdC = p3ItemC.data?.item?._id;
    if (p3IdC) createdItemIds.push(p3IdC);

    // Case 15: Search by title & description (case-insensitive) + regex character escaping
    const searchTitleRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(`[c++] guide ${runTag}`)}`
    );
    const searchDescRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(`(CALC)* for ${runTag}`)}`
    );
    record(
      15,
      "Phase 3 Search: Case-insensitive title/description match & safe regex escaping",
      searchTitleRes.status === 200 &&
        searchTitleRes.data?.items?.length === 1 &&
        searchTitleRes.data.items[0]._id === p3IdA &&
        searchDescRes.status === 200 &&
        searchDescRes.data?.items?.length === 1 &&
        searchDescRes.data.items[0]._id === p3IdA,
      `${searchTitleRes.status}/${searchDescRes.status}`
    );

    // Case 16: Combined filters (q + type + category + location + status + dateFrom/dateTo)
    const combinedFilterRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&type=LOST&category=Electronics&location=${encodeURIComponent("science wing")}&status=OPEN&dateFrom=2026-03-01&dateTo=2026-03-31`
    );
    record(
      16,
      "Phase 3 Filters: Combined q, type, category, location, status, and date range return exact match",
      combinedFilterRes.status === 200 &&
        combinedFilterRes.data?.items?.length === 1 &&
        combinedFilterRes.data.items[0]._id === p3IdC,
      combinedFilterRes.status
    );

    // Case 17: Deterministic sorting (newest, oldest, itemDate_asc, itemDate_desc)
    const sortAscRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&sort=itemDate_asc`
    );
    const sortDescRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&sort=itemDate_desc`
    );
    const ascIds = (sortAscRes.data?.items || []).map((i) => i._id);
    const descIds = (sortDescRes.data?.items || []).map((i) => i._id);
    record(
      17,
      "Phase 3 Sorting: itemDate_asc and itemDate_desc order items deterministically",
      sortAscRes.status === 200 &&
        sortDescRes.status === 200 &&
        ascIds[0] === p3IdA &&
        ascIds[2] === p3IdC &&
        descIds[0] === p3IdC &&
        descIds[2] === p3IdA,
      `${sortAscRes.status}/${sortDescRes.status}`
    );

    // Case 18: Server-side pagination metadata & out-of-range page handling
    const page1Res = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&sort=oldest&page=1&limit=2`
    );
    const page2Res = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&sort=oldest&page=2&limit=2`
    );
    const outOfRangeRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}&page=99&limit=2`
    );
    record(
      18,
      "Phase 3 Pagination: Metadata accuracy across pages and graceful empty array on out-of-range page",
      page1Res.status === 200 &&
        page1Res.data?.items?.length === 2 &&
        page1Res.data?.pagination?.totalItems === 3 &&
        page1Res.data?.pagination?.totalPages === 2 &&
        page1Res.data?.pagination?.hasNextPage === true &&
        page2Res.status === 200 &&
        page2Res.data?.items?.length === 1 &&
        page2Res.data?.pagination?.hasPrevPage === true &&
        outOfRangeRes.status === 200 &&
        Array.isArray(outOfRangeRes.data?.items) &&
        outOfRangeRes.data.items.length === 0,
      `${page1Res.status}/${page2Res.status}/${outOfRangeRes.status}`
    );

    // Case 19: Invalid search/filter/sort/pagination parameters rejected with 400
    const badType = await apiRequest(baseUrl, "/api/items?type=STOLEN");
    const badCat = await apiRequest(baseUrl, "/api/items?category=Vehicles");
    const badSort = await apiRequest(baseUrl, "/api/items?sort=passwordHash");
    const badPage = await apiRequest(baseUrl, "/api/items?page=0");
    const badLimit = await apiRequest(baseUrl, "/api/items?limit=51");
    const badDateRange = await apiRequest(
      baseUrl,
      "/api/items?dateFrom=2026-05-10&dateTo=2026-05-01"
    );
    const objInjection = await apiRequest(
      baseUrl,
      "/api/items?q[$ne]=anything"
    );
    record(
      19,
      "Phase 3 Validation: Invalid type, category, sort, page, limit, date range, and query object injection return 400",
      badType.status === 400 &&
        badCat.status === 400 &&
        badSort.status === 400 &&
        badPage.status === 400 &&
        badLimit.status === 400 &&
        badDateRange.status === 400 &&
        objInjection.status === 400,
      `${badType.status}/${badCat.status}/${badSort.status}/${badPage.status}/${badLimit.status}/${badDateRange.status}/${objInjection.status}`
    );

    // Case 20: Moderated reports never appear in search or filtered public results
    const searchModRes = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(`Test Notebook ${runTag}`)}&status=CLOSED`
    );
    record(
      20,
      "Phase 3 Moderation Privacy: Moderated item never appears in targeted public search/status filters",
      searchModRes.status === 200 &&
        searchModRes.data?.items?.length === 0 &&
        searchModRes.data?.pagination?.totalItems === 0,
      searchModRes.status
    );

    // ── Phase 4: Claim & Ownership Verification Tests ─────────────────────

    // Create a third student (Student C) to test multi-claimant and unauthorized review scenarios
    const studentCEmail = `sec-student-c-${runTag}@test.lostlink.local`;
    const credC = createTestGoogleCredential({
      email: studentCEmail,
      name: "Test Student C",
    });
    const regC = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: credC },
    });
    if (regC.data?.user?.id) createdUserIds.push(regC.data.user.id);
    const tokenC = regC.data?.token;

    // Ensure indexes on Claim collection are built before testing duplicate/race constraints
    await Claim.init();

    // Case 21: Unauthenticated claim submission & listing rejected with 401
    const unauthClaimPost = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      body: {
        itemId: p3IdB,
        proofDescription: "Unauthenticated claim attempt with valid length",
      },
    });
    const unauthClaimMine = await apiRequest(baseUrl, "/api/claims/mine");
    record(
      21,
      "Phase 4 Auth: Unauthenticated claim submission and listing return 401",
      unauthClaimPost.status === 401 && unauthClaimMine.status === 401,
      `${unauthClaimPost.status}/${unauthClaimMine.status}`
    );

    // Case 22: Claim submission on an eligible FOUND item (p3IdB, owned by Student A) by Student B
    const secretProofText = `PRIVATE_PROOF_${runTag}_Engraved_Initials_SB_99`;
    const validClaimB = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: p3IdB,
        proofDescription: secretProofText,
        status: "APPROVED", // Attempt privilege escalation on status
        claimant: regA.data.user.id, // Attempt spoofing claimant
      },
    });
    const claimB1Id = validClaimB.data?.claim?._id;
    if (claimB1Id) createdClaimIds.push(claimB1Id);
    const itemBAfterClaim = await Item.findById(p3IdB);
    record(
      22,
      "Phase 4 Submit: Valid claim on FOUND item succeeds (201), forces PENDING, and sets item to CLAIM_PENDING",
      validClaimB.status === 201 &&
        validClaimB.data?.claim?.status === "PENDING" &&
        validClaimB.data?.claim?.claimant === regB.data.user.id &&
        itemBAfterClaim?.status === "CLAIM_PENDING",
      validClaimB.status
    );

    // Case 23: Self-claim rejection (Student A attempting to claim their own FOUND item p3IdB)
    const selfClaimRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenA,
      body: {
        itemId: p3IdB,
        proofDescription: "I am the reporter trying to claim my own found report",
      },
    });
    record(
      23,
      "Phase 4 Self-Claim: Report owner cannot claim their own report (403)",
      selfClaimRes.status === 403,
      selfClaimRes.status
    );

    // Case 24: Duplicate active claim rejection (Student B submitting a second PENDING claim on p3IdB)
    const dupClaimRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: p3IdB,
        proofDescription: "Second duplicate active claim on the same item",
      },
    });
    record(
      24,
      "Phase 4 Duplicate: Second active claim by same student on same item returns 409",
      dupClaimRes.status === 409,
      dupClaimRes.status
    );

    // Case 25: Claiming an ineligible (LOST) or moderated item is rejected
    const claimLostItemRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: p3IdA, // LOST item
        proofDescription: "Attempting to claim a LOST report instead of FOUND",
      },
    });
    const claimModeratedItemRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: item2Id, // Moderated FOUND item from Case 12
        proofDescription: "Attempting to claim a moderated hidden report",
      },
    });
    record(
      25,
      "Phase 4 Eligibility: Claiming LOST item (400) or moderated item (404) is rejected",
      claimLostItemRes.status === 400 && claimModeratedItemRes.status === 404,
      `${claimLostItemRes.status}/${claimModeratedItemRes.status}`
    );

    // Case 26: Unauthorized review by unrelated student (Student C trying to approve Student B's claim)
    const unauthReviewByC = await apiRequest(
      baseUrl,
      `/api/claims/${claimB1Id}/review`,
      {
        method: "PATCH",
        token: tokenC,
        body: { status: "APPROVED" },
      }
    );
    record(
      26,
      "Phase 4 Review Auth: Unrelated student cannot review another item's claim (403)",
      unauthReviewByC.status === 403,
      unauthReviewByC.status
    );

    // Case 27: Claimant attempting to approve their own claim (including admin self-approval check)
    const selfApproveByB = await apiRequest(
      baseUrl,
      `/api/claims/${claimB1Id}/review`,
      {
        method: "PATCH",
        token: tokenB,
        body: { status: "APPROVED" },
      }
    );
    const adminClaimOnB = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenAdmin,
      body: {
        itemId: p3IdB,
        proofDescription: "Admin user submitting a personal claim on found item",
      },
    });
    const adminClaimId = adminClaimOnB.data?.claim?._id;
    if (adminClaimId) createdClaimIds.push(adminClaimId);
    const adminSelfApprove = await apiRequest(
      baseUrl,
      `/api/claims/${adminClaimId}/review`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "APPROVED" },
      }
    );
    record(
      27,
      "Phase 4 Self-Approval: Claimant cannot approve their own claim (403 for student & admin claimant)",
      selfApproveByB.status === 403 && adminSelfApprove.status === 403,
      `${selfApproveByB.status}/${adminSelfApprove.status}`
    );

    // Case 28: Valid rejection by item owner (Student A rejects adminClaimId and claimB1Id, reverting item to OPEN)
    const ownerReject1 = await apiRequest(
      baseUrl,
      `/api/claims/${adminClaimId}/review`,
      {
        method: "PATCH",
        token: tokenA,
        body: { status: "REJECTED", reviewNote: "Did not match key ring color" },
      }
    );
    const ownerReject2 = await apiRequest(
      baseUrl,
      `/api/claims/${claimB1Id}/review`,
      {
        method: "PATCH",
        token: tokenA,
        body: { status: "REJECTED", reviewNote: "Initials did not match" },
      }
    );
    const itemBAfterRejections = await Item.findById(p3IdB);
    record(
      28,
      "Phase 4 Rejection: Owner can reject pending claims (200) and item reverts to OPEN when 0 active claims remain",
      ownerReject1.status === 200 &&
        ownerReject2.status === 200 &&
        ownerReject2.data?.claim?.status === "REJECTED" &&
        ownerReject2.data?.claim?.reviewedBy?._id === regA.data.user.id &&
        itemBAfterRejections?.status === "OPEN",
      `${ownerReject1.status}/${ownerReject2.status}`
    );

    // Case 29: Invalid review status transitions (invalid status enum -> 400; re-reviewing REJECTED claim -> 409)
    const badDecisionEnum = await apiRequest(
      baseUrl,
      `/api/claims/${claimB1Id}/review`,
      {
        method: "PATCH",
        token: tokenA,
        body: { status: "PENDING" },
      }
    );
    const reReviewRejected = await apiRequest(
      baseUrl,
      `/api/claims/${claimB1Id}/review`,
      {
        method: "PATCH",
        token: tokenA,
        body: { status: "APPROVED" },
      }
    );
    record(
      29,
      "Phase 4 Transitions: Invalid decision enum (400) and re-reviewing finalized claim (409) are rejected",
      badDecisionEnum.status === 400 && reReviewRejected.status === 409,
      `${badDecisionEnum.status}/${reReviewRejected.status}`
    );

    // Case 30: Concurrent claim approvals & race-condition handling
    // Both Student B (after previous rejection) and Student C submit new PENDING claims on p3IdB
    const newClaimB = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: p3IdB,
        proofDescription: `${secretProofText}_Updated_With_Key_Brand_Yale`,
      },
    });
    const newClaimC = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenC,
      body: {
        itemId: p3IdB,
        proofDescription: "Competing claim from Student C with different description",
      },
    });
    const claimB2Id = newClaimB.data?.claim?._id;
    const claimC1Id = newClaimC.data?.claim?._id;
    if (claimB2Id) createdClaimIds.push(claimB2Id);
    if (claimC1Id) createdClaimIds.push(claimC1Id);

    // Fire two concurrent approval requests (owner + admin) for the two competing claims
    const [raceRes1, raceRes2] = await Promise.all([
      apiRequest(baseUrl, `/api/claims/${claimB2Id}/review`, {
        method: "PATCH",
        token: tokenA,
        body: { status: "APPROVED", reviewNote: "Owner verified Student B" },
      }),
      apiRequest(baseUrl, `/api/claims/${claimC1Id}/review`, {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "APPROVED", reviewNote: "Concurrent admin approval" },
      }),
    ]);
    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    const approvedCountInDb = await Claim.countDocuments({
      item: p3IdB,
      status: "APPROVED",
    });
    const itemBAfterApproval = await Item.findById(p3IdB);
    record(
      30,
      "Phase 4 Concurrency: Concurrent approvals on same item allow exactly one 200 and one 409; item becomes RETURNED",
      raceStatuses[0] === 200 &&
        raceStatuses[1] === 409 &&
        approvedCountInDb === 1 &&
        itemBAfterApproval?.status === "RETURNED",
      `${raceStatuses[0]}/${raceStatuses[1]}`
    );

    // Case 31: Private claim identifying answers never appear in public item API responses
    const publicItemsCheck = await apiRequest(
      baseUrl,
      `/api/items?q=${encodeURIComponent(runTag)}`
    );
    const leaksProofInPublic =
      publicItemsCheck.text.includes(secretProofText) ||
      publicItemsCheck.text.includes("proofDescription");
    record(
      31,
      "Phase 4 Privacy: Private claim proofDescription never appears in public GET /api/items responses",
      publicItemsCheck.status === 200 && !leaksProofInPublic,
      publicItemsCheck.status
    );

    // Case 32: My Claims (/api/claims/mine) and Received Claims (/api/claims/received) scoping
    const mineBRes = await apiRequest(baseUrl, "/api/claims/mine", {
      token: tokenB,
    });
    const receivedARes = await apiRequest(baseUrl, "/api/claims/received", {
      token: tokenA,
    });
    const receivedCRes = await apiRequest(baseUrl, "/api/claims/received", {
      token: tokenC,
    });
    record(
      32,
      "Phase 4 Queue Scoping: /api/claims/mine and /api/claims/received return only authorized records",
      mineBRes.status === 200 &&
        mineBRes.data?.claims?.length === 2 &&
        receivedARes.status === 200 &&
        receivedARes.data?.claims?.length >= 3 &&
        receivedCRes.status === 200 &&
        receivedCRes.data?.claims?.length === 0,
      `${mineBRes.status}/${receivedARes.status}/${receivedCRes.status}`
    );

    // Case 33: Concurrent duplicate claim submissions & item-claim status reconciliation
    const p4RaceItem = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P4-Race-Watch ${runTag}`,
        description: `Casio watch found near gym ${runTag}`,
        category: "Accessories",
        type: "FOUND",
        location: "Campus Gym",
        itemDate: "2026-03-25T00:00:00.000Z",
      },
    });
    const p4RaceItemId = p4RaceItem.data?.item?._id;
    if (p4RaceItemId) createdItemIds.push(p4RaceItemId);

    const [dupSub1, dupSub2] = await Promise.all([
      apiRequest(baseUrl, "/api/claims", {
        method: "POST",
        token: tokenB,
        body: {
          itemId: p4RaceItemId,
          proofDescription: "Concurrent claim submission attempt 1 with strap scratch detail",
        },
      }),
      apiRequest(baseUrl, "/api/claims", {
        method: "POST",
        token: tokenB,
        body: {
          itemId: p4RaceItemId,
          proofDescription: "Concurrent claim submission attempt 2 with strap scratch detail",
        },
      }),
    ]);
    if (dupSub1.data?.claim?._id) createdClaimIds.push(dupSub1.data.claim._id);
    if (dupSub2.data?.claim?._id) createdClaimIds.push(dupSub2.data.claim._id);

    const dupSubStatuses = [dupSub1.status, dupSub2.status].sort();
    const activeRaceClaims = await Claim.countDocuments({
      item: p4RaceItemId,
      claimant: regB.data.user.id,
      status: "PENDING",
    });
    const raceItemAfter = await Item.findById(p4RaceItemId);
    record(
      33,
      "Phase 4 DB Consistency: Concurrent duplicate claim submissions allow one 201 and one 409 with consistent CLAIM_PENDING item state",
      dupSubStatuses[0] === 201 &&
        dupSubStatuses[1] === 409 &&
        activeRaceClaims === 1 &&
        raceItemAfter?.status === "CLAIM_PENDING",
      `${dupSubStatuses[0]}/${dupSubStatuses[1]}`
    );

    // Case 34: Legacy FOUND item without reportedBy can be claimed by a student (201) and reviewed by an admin (200) without TypeError (500)
    const legacyInsert = await mongoose.connection.db
      .collection("items")
      .insertOne({
        title: `Legacy Phase 1 Wallet ${runTag}`,
        description: `Created before reportedBy existed ${runTag}`,
        category: "Accessories",
        type: "FOUND",
        location: "Old Campus Gate",
        itemDate: new Date("2026-01-05T00:00:00.000Z"),
        status: "OPEN",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const legacyItemId = legacyInsert.insertedId;
    if (legacyItemId) createdItemIds.push(legacyItemId);

    const legacyClaimRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: legacyItemId.toString(),
        proofDescription:
          "Brown leather bi-fold wallet with campus library card inside",
      },
    });
    const legacyClaimId = legacyClaimRes.data?.claim?._id;
    if (legacyClaimId) createdClaimIds.push(legacyClaimId);

    const legacyAdminReviewRes = await apiRequest(
      baseUrl,
      `/api/claims/${legacyClaimId}/review`,
      {
        method: "PATCH",
        token: tokenAdmin,
        body: {
          status: "APPROVED",
          reviewNote: "Verified legacy item claim by admin",
        },
      }
    );
    const legacyItemAfter = await Item.findById(legacyItemId);
    record(
      34,
      "Phase 4 Legacy Item Regression: FOUND item without reportedBy can be claimed (201) and admin-reviewed (200) without 500 TypeError",
      legacyClaimRes.status === 201 &&
        legacyAdminReviewRes.status === 200 &&
        legacyAdminReviewRes.data?.claim?.status === "APPROVED" &&
        legacyItemAfter?.status === "RETURNED",
      `${legacyClaimRes.status}/${legacyAdminReviewRes.status}`
    );

    // ── Phase 5A: Smart Lost & Found Matching Engine Tests ────────────────

    // Case 35: Exact title/description/category/location/date match awards 100 points & all 5 reasons
    const exactSource = {
      _id: new mongoose.Types.ObjectId(),
      title: "Silver Apple AirPods Pro Case",
      description: "White charging case with blue silicone cover and lanyard",
      category: "Electronics",
      type: "LOST",
      location: "Central Library 2nd Floor",
      itemDate: new Date("2026-04-01T10:00:00.000Z"),
      status: "OPEN",
      moderated: false,
    };
    const exactCandidate = {
      _id: new mongoose.Types.ObjectId(),
      title: "Silver Apple AirPods Pro Case",
      description: "White charging case with blue silicone cover and lanyard",
      category: "Electronics",
      type: "FOUND",
      location: "Central Library 2nd Floor",
      itemDate: new Date("2026-04-01T14:00:00.000Z"),
      status: "OPEN",
      moderated: false,
    };
    const exactScore = scoreItemPair(exactSource, exactCandidate);
    record(
      35,
      "Phase 5A Exact Match: Identical title, description, category, location, and same-day date yields 100/100 (30+25+20+15+10)",
      exactScore !== null &&
        exactScore.matchScore === 100 &&
        exactScore.scoreBreakdown.title === 30 &&
        exactScore.scoreBreakdown.description === 25 &&
        exactScore.scoreBreakdown.category === 20 &&
        exactScore.scoreBreakdown.location === 15 &&
        exactScore.scoreBreakdown.date === 10 &&
        exactScore.reasons.length === 5,
      "UNIT:100"
    );

    // Case 36: Partial title/description keyword matches & protection against mere substring coincidence
    const partialCandidate = {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      title: "Apple AirPods Case",
      description: "Found white charging case near study desk",
    };
    const substringCoincidenceCandidate = {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      title: "Silverware Set in Case",
      description: "Protractor and apple juice bottle",
      category: "Other",
      location: "Cafeteria",
      itemDate: new Date("2026-01-01T00:00:00.000Z"),
    };
    const partialRes = scoreItemPair(exactSource, partialCandidate);
    const subCoincidenceRes = scoreItemPair(
      {
        ...exactSource,
        title: "Cat Keyring",
        description: "Metal ring",
      },
      {
        ...substringCoincidenceCandidate,
        title: "Catalog of Courses",
        description: "Category binder",
      }
    );
    record(
      36,
      "Phase 5A Partial Keywords & Substring Guard: Partial keywords get proportional score; 'cat' vs 'catalog' gets 0 title/desc points",
      partialRes !== null &&
        partialRes.scoreBreakdown.title > 0 &&
        partialRes.scoreBreakdown.title < 30 &&
        partialRes.scoreBreakdown.description > 0 &&
        partialRes.scoreBreakdown.description < 25 &&
        subCoincidenceRes !== null &&
        subCoincidenceRes.scoreBreakdown.title === 0 &&
        subCoincidenceRes.scoreBreakdown.description === 0,
      `UNIT:${partialRes?.matchScore}/${subCoincidenceRes?.matchScore}`
    );

    // Case 37: Category mismatch awards 0 category points
    const diffCatRes = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      category: "Accessories",
    });
    record(
      37,
      "Phase 5A Category Mismatch: Different category yields 0 category points (total 80 instead of 100)",
      diffCatRes !== null &&
        diffCatRes.scoreBreakdown.category === 0 &&
        diffCatRes.matchScore === 80,
      `UNIT:${diffCatRes?.matchScore}`
    );

    // Case 38: Location similarity (exact 15, partial shared token 5..14, unrelated 0)
    const partialLocRes = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      location: "Central Library Main Desk",
    });
    const diffLocRes = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      location: "South Football Stadium",
    });
    record(
      38,
      "Phase 5A Location Similarity: Partial location overlap yields 5..14 pts; unrelated location yields 0 pts",
      partialLocRes !== null &&
        partialLocRes.scoreBreakdown.location >= 5 &&
        partialLocRes.scoreBreakdown.location <= 14 &&
        diffLocRes !== null &&
        diffLocRes.scoreBreakdown.location === 0,
      `UNIT:${partialLocRes?.scoreBreakdown?.location}/${diffLocRes?.scoreBreakdown?.location}`
    );

    // Case 39: Date proximity (within 3 days -> 8 pts, within 7 days -> 6 pts, > 30 days -> 0 pts)
    const date3Days = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      itemDate: new Date("2026-04-03T10:00:00.000Z"),
    });
    const date6Days = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      itemDate: new Date("2026-04-07T10:00:00.000Z"),
    });
    const date45Days = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: new mongoose.Types.ObjectId(),
      itemDate: new Date("2026-05-20T10:00:00.000Z"),
    });
    record(
      39,
      "Phase 5A Date Proximity: 2 days apart -> 8 pts, 6 days -> 6 pts, 45 days -> 0 pts",
      date3Days?.scoreBreakdown?.date === 8 &&
        date6Days?.scoreBreakdown?.date === 6 &&
        date45Days?.scoreBreakdown?.date === 0,
      `UNIT:${date3Days?.scoreBreakdown?.date}/${date6Days?.scoreBreakdown?.date}/${date45Days?.scoreBreakdown?.date}`
    );

    // Case 40: Missing or empty optional fields handled safely without throwing
    const missingFieldsRes = scoreItemPair(
      {
        _id: new mongoose.Types.ObjectId(),
        title: "",
        description: null,
        category: "Keys",
        type: "LOST",
        location: undefined,
        itemDate: null,
        status: "OPEN",
      },
      {
        _id: new mongoose.Types.ObjectId(),
        title: undefined,
        description: "",
        category: "Keys",
        type: "FOUND",
        location: "",
        itemDate: "invalid-date",
        status: "OPEN",
      }
    );
    record(
      40,
      "Phase 5A Missing Fields Safety: Null/undefined/empty fields do not crash and score category cleanly (20)",
      missingFieldsRes !== null && missingFieldsRes.matchScore === 20,
      `UNIT:${missingFieldsRes?.matchScore}`
    );

    // Case 41 & 42: Unit check for same-type (LOST vs LOST) and self-match prevention
    const sameTypeScore = scoreItemPair(exactSource, {
      ...exactCandidate,
      type: "LOST",
    });
    const selfMatchScore = scoreItemPair(exactSource, {
      ...exactCandidate,
      _id: exactSource._id,
    });
    record(
      41,
      "Phase 5A Same-Type Guard: LOST report never matches another LOST report (returns null)",
      sameTypeScore === null,
      "UNIT:null"
    );
    record(
      42,
      "Phase 5A Self-Match Guard: Item never matches itself (returns null)",
      selfMatchScore === null,
      "UNIT:null"
    );

    // Live API Matching Tests (Cases 43–48)
    const matchLostRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `Blue Bose Headphones ${runTag}`,
        description: `Noise cancelling over-ear headphones in hard case ${runTag}`,
        category: "Electronics",
        type: "LOST",
        location: "Engineering Block B",
        itemDate: "2026-03-18T00:00:00.000Z",
      },
    });
    const matchLostId = matchLostRes.data?.item?._id;
    if (matchLostId) createdItemIds.push(matchLostId);

    const matchFoundStrongRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenB,
      body: {
        title: `Blue Bose Headphones ${runTag}`,
        description: `Over-ear Bose headphones found in black hard case ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Block B",
        itemDate: "2026-03-19T00:00:00.000Z",
      },
    });
    const matchFoundStrongId = matchFoundStrongRes.data?.item?._id;
    if (matchFoundStrongId) createdItemIds.push(matchFoundStrongId);

    const matchFoundMediumRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenB,
      body: {
        title: `Black Headphones ${runTag}`,
        description: `Wired headphones found on bench ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Block C",
        itemDate: "2026-03-22T00:00:00.000Z",
      },
    });
    const matchFoundMediumId = matchFoundMediumRes.data?.item?._id;
    if (matchFoundMediumId) createdItemIds.push(matchFoundMediumId);

    const matchFoundModeratedRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenB,
      body: {
        title: `Blue Bose Headphones ${runTag}`,
        description: `Exact duplicate but moderated ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Block B",
        itemDate: "2026-03-18T00:00:00.000Z",
      },
    });
    const matchFoundModeratedId = matchFoundModeratedRes.data?.item?._id;
    if (matchFoundModeratedId) {
      createdItemIds.push(matchFoundModeratedId);
      await apiRequest(
        baseUrl,
        `/api/admin/items/${matchFoundModeratedId}`,
        {
          method: "DELETE",
          token: tokenAdmin,
          body: { reason: "Moderated spam match test" },
        }
      );
    }

    // Add a private claim on matchFoundStrongId to test that claim proof never leaks in match results
    const matchClaimSecret = `MATCH_CLAIM_SECRET_${runTag}_Serial_998877`;
    const matchClaimRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenC,
      body: {
        itemId: matchFoundStrongId,
        proofDescription: matchClaimSecret,
      },
    });
    if (matchClaimRes.data?.claim?._id) {
      createdClaimIds.push(matchClaimRes.data.claim._id);
    }

    // Case 43: Moderated & RETURNED/CLOSED items excluded from candidates and rejected as source items
    const matchesForModeratedSource = await apiRequest(
      baseUrl,
      `/api/items/${matchFoundModeratedId}/matches`,
      { token: tokenA }
    );
    const matchesForReturnedSource = await apiRequest(
      baseUrl,
      `/api/items/${p3IdB}/matches`, // p3IdB is RETURNED from Case 30
      { token: tokenA }
    );
    const liveMatchesRes = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches`,
      { token: tokenA }
    );
    const returnedOrModInCandidates = (liveMatchesRes.data?.matches || []).some(
      (m) =>
        m.item._id === matchFoundModeratedId ||
        m.item._id === p3IdB ||
        m.item.status === "RETURNED" ||
        m.item.status === "CLOSED"
    );
    record(
      43,
      "Phase 5A Eligibility & Moderation: Moderated source (404), RETURNED source (409), and moderated/returned candidates excluded",
      matchesForModeratedSource.status === 404 &&
        matchesForReturnedSource.status === 409 &&
        liveMatchesRes.status === 200 &&
        !returnedOrModInCandidates,
      `${matchesForModeratedSource.status}/${matchesForReturnedSource.status}/${liveMatchesRes.status}`
    );

    // Case 44: Invalid item IDs (400), invalid query params (400), and unauthenticated requests (401)
    const matchUnauth = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches`
    );
    const matchBadId = await apiRequest(
      baseUrl,
      "/api/items/not-an-object-id/matches",
      { token: tokenA }
    );
    const matchBadLimit = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches?limit=99`,
      { token: tokenA }
    );
    const matchBadUnknownKey = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches?arbitrary=1`,
      { token: tokenA }
    );
    record(
      44,
      "Phase 5A Auth & Validation: Unauthenticated (401), invalid ID (400), invalid limit (400), and unknown query param (400) rejected",
      matchUnauth.status === 401 &&
        matchBadId.status === 400 &&
        matchBadLimit.status === 400 &&
        matchBadUnknownKey.status === 400,
      `${matchUnauth.status}/${matchBadId.status}/${matchBadLimit.status}/${matchBadUnknownKey.status}`
    );

    // Case 45: Private claim proof never leaked & matching does not mutate item/claim status
    const matchLeaksSecret =
      liveMatchesRes.text.includes(matchClaimSecret) ||
      liveMatchesRes.text.includes("proofDescription") ||
      liveMatchesRes.text.includes("moderationReason");
    const lostItemAfterMatchCall = await Item.findById(matchLostId);
    record(
      45,
      "Phase 5A Privacy & Non-Mutation: Match API never leaks claim proofDescription or moderation fields and does not mutate item status",
      liveMatchesRes.status === 200 &&
        !matchLeaksSecret &&
        lostItemAfterMatchCall?.status === "OPEN",
      liveMatchesRes.status
    );

    // Case 46: Stable score ordering and score boundaries in live API
    const matchList = liveMatchesRes.data?.matches || [];
    const topMatch = matchList[0];
    const secondMatch = matchList.find(
      (m) => m.item._id === matchFoundMediumId
    );
    const scoresInBoundsAndSorted =
      matchList.length >= 2 &&
      topMatch?.item?._id === matchFoundStrongId &&
      secondMatch !== undefined &&
      topMatch.matchScore > secondMatch.matchScore &&
      matchList.every(
        (m, idx) =>
          m.matchScore >= 15 &&
          m.matchScore <= 100 &&
          Array.isArray(m.reasons) &&
          m.reasons.length > 0 &&
          (idx === 0 || matchList[idx - 1].matchScore >= m.matchScore)
      );
    record(
      46,
      "Phase 5A Ranking & Boundaries: Matches sorted descending by matchScore within [15, 100] with explainable reasons",
      scoresInBoundsAndSorted,
      `${topMatch?.matchScore}/${secondMatch?.matchScore}`
    );

    // Case 47: Legacy records without reportedBy work safely as source or candidate in matching
    const legacyMatchItemInsert = await mongoose.connection.db
      .collection("items")
      .insertOne({
        title: `Blue Bose Headphones ${runTag}`,
        description: `Legacy found Bose headphones ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Block B",
        itemDate: new Date("2026-03-18T00:00:00.000Z"),
        status: "OPEN",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const legacyMatchItemId = legacyMatchItemInsert.insertedId;
    if (legacyMatchItemId) createdItemIds.push(legacyMatchItemId);

    const legacyAsSourceRes = await apiRequest(
      baseUrl,
      `/api/items/${legacyMatchItemId}/matches`,
      { token: tokenA }
    );
    const legacyInCandidateRes = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches`,
      { token: tokenA }
    );
    const legacyFoundInMatches = (
      legacyInCandidateRes.data?.matches || []
    ).some((m) => m.item._id === legacyMatchItemId.toString());
    record(
      47,
      "Phase 5A Legacy Compatibility: Legacy item without reportedBy succeeds both as source item and as matched candidate",
      legacyAsSourceRes.status === 200 &&
        legacyAsSourceRes.data?.matches?.length >= 1 &&
        legacyInCandidateRes.status === 200 &&
        legacyFoundInMatches,
      `${legacyAsSourceRes.status}/${legacyInCandidateRes.status}`
    );

    // Case 48: Bidirectional symmetry (FOUND -> LOST matches LOST -> FOUND) & heuristic disclaimer included
    const reverseMatchRes = await apiRequest(
      baseUrl,
      `/api/items/${matchFoundStrongId}/matches`,
      { token: tokenB }
    );
    const reverseTop = (reverseMatchRes.data?.matches || []).find(
      (m) => m.item._id === matchLostId
    );
    record(
      48,
      "Phase 5A Bidirectional Symmetry: FOUND->LOST score matches LOST->FOUND score and includes heuristic disclaimer",
      reverseMatchRes.status === 200 &&
        reverseMatchRes.data?.sourceType === "FOUND" &&
        reverseMatchRes.data?.candidateType === "LOST" &&
        typeof reverseMatchRes.data?.disclaimer === "string" &&
        reverseTop !== undefined &&
        reverseTop.matchScore === topMatch?.matchScore,
      `${reverseMatchRes.status}:${reverseTop?.matchScore}`
    );

    // ── Phase 5C: Smart Matching Integration, Security & Regression Audit ──

    // Case 49: Missing valid ObjectId source (404), CLOSED source (409), and expired JWT (401) on /api/items/:id/matches
    const missingItemId = new mongoose.Types.ObjectId().toString();
    const matchMissingSource = await apiRequest(
      baseUrl,
      `/api/items/${missingItemId}/matches`,
      { token: tokenA }
    );
    const closedSourceCreate = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `Closed Source Bose ${runTag}`,
        description: `Closed item should not allow matching ${runTag}`,
        category: "Electronics",
        type: "LOST",
        location: "Engineering Block B",
        itemDate: "2026-03-18T00:00:00.000Z",
      },
    });
    const closedSourceId = closedSourceCreate.data?.item?._id;
    if (closedSourceId) {
      createdItemIds.push(closedSourceId);
      await apiRequest(baseUrl, `/api/admin/items/${closedSourceId}/status`, {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "CLOSED" },
      });
    }
    const matchClosedSource = await apiRequest(
      baseUrl,
      `/api/items/${closedSourceId}/matches`,
      { token: tokenA }
    );
    const expiredMatchToken = jwt.sign(
      { sub: regA.data.user.id, role: "student" },
      process.env.JWT_SECRET,
      { expiresIn: -10 }
    );
    const matchExpiredJwt = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches`,
      { token: expiredMatchToken }
    );
    record(
      49,
      "Phase 5C Source & Session Guards: Missing source (404), CLOSED source (409), and expired JWT (401) rejected",
      matchMissingSource.status === 404 &&
        matchClosedSource.status === 409 &&
        matchExpiredJwt.status === 401,
      `${matchMissingSource.status}/${matchClosedSource.status}/${matchExpiredJwt.status}`
    );

    // Case 50: Comprehensive limit and minScore boundary validation
    const [
      badLimZero,
      badLimNeg,
      badLimHigh,
      badMinZero,
      badMinHigh,
      badMinNaN,
      badArrParam,
    ] = await Promise.all([
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?limit=0`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?limit=-2`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?limit=21`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?minScore=0`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?minScore=101`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?minScore=abc`, {
        token: tokenA,
      }),
      apiRequest(baseUrl, `/api/items/${matchLostId}/matches?limit=1&limit=2`, {
        token: tokenA,
      }),
    ]);
    record(
      50,
      "Phase 5C Query Boundary Validation: Out-of-range, non-numeric, and duplicate array limit/minScore params return 400",
      badLimZero.status === 400 &&
        badLimNeg.status === 400 &&
        badLimHigh.status === 400 &&
        badMinZero.status === 400 &&
        badMinHigh.status === 400 &&
        badMinNaN.status === 400 &&
        badArrParam.status === 400,
      `${badLimZero.status}/${badLimHigh.status}/${badMinZero.status}/${badMinHigh.status}/${badArrParam.status}`
    );

    // Case 51: Live limit and minScore filtering behavior
    const [limitOneRes, highMinScoreRes, impossibleMinScoreRes] =
      await Promise.all([
        apiRequest(baseUrl, `/api/items/${matchLostId}/matches?limit=1`, {
          token: tokenA,
        }),
        apiRequest(baseUrl, `/api/items/${matchLostId}/matches?minScore=85`, {
          token: tokenA,
        }),
        apiRequest(baseUrl, `/api/items/${matchLostId}/matches?minScore=99`, {
          token: tokenA,
        }),
      ]);
    const highMinMatches = highMinScoreRes.data?.matches || [];
    record(
      51,
      "Phase 5C Limit & MinScore Filtering: limit=1 caps count at 1, minScore=85 filters medium match, minScore=99 returns empty list",
      limitOneRes.status === 200 &&
        limitOneRes.data?.count === 1 &&
        limitOneRes.data?.matches?.length === 1 &&
        highMinScoreRes.status === 200 &&
        highMinMatches.length >= 1 &&
        highMinMatches.every((m) => m.matchScore >= 85) &&
        !highMinMatches.some((m) => m.item._id === matchFoundMediumId) &&
        impossibleMinScoreRes.status === 200 &&
        impossibleMinScoreRes.data?.count === 0 &&
        Array.isArray(impossibleMinScoreRes.data?.matches) &&
        impossibleMinScoreRes.data.matches.length === 0,
      `${limitOneRes.data?.count}/${highMinMatches.length}/${impossibleMinScoreRes.data?.count}`
    );

    // Case 52: Live API same-type exclusion and CLOSED candidate exclusion
    const twinLostRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenB,
      body: {
        title: `Blue Bose Headphones ${runTag}`,
        description: `Noise cancelling over-ear headphones in hard case ${runTag}`,
        category: "Electronics",
        type: "LOST",
        location: "Engineering Block B",
        itemDate: "2026-03-18T00:00:00.000Z",
      },
    });
    const twinLostId = twinLostRes.data?.item?._id;
    if (twinLostId) createdItemIds.push(twinLostId);

    const closedCandidateRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenB,
      body: {
        title: `Blue Bose Headphones ${runTag}`,
        description: `Noise cancelling over-ear headphones in hard case ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Block B",
        itemDate: "2026-03-18T00:00:00.000Z",
      },
    });
    const closedCandidateId = closedCandidateRes.data?.item?._id;
    if (closedCandidateId) {
      createdItemIds.push(closedCandidateId);
      await apiRequest(
        baseUrl,
        `/api/admin/items/${closedCandidateId}/status`,
        {
          method: "PATCH",
          token: tokenAdmin,
          body: { status: "CLOSED" },
        }
      );
    }

    const afterTwinAndClosedRes = await apiRequest(
      baseUrl,
      `/api/items/${matchLostId}/matches?limit=20`,
      { token: tokenA }
    );
    const afterTwinMatches = afterTwinAndClosedRes.data?.matches || [];
    const containsSameTypeOrClosed = afterTwinMatches.some(
      (m) =>
        m.item._id === twinLostId ||
        m.item._id === closedCandidateId ||
        m.item.type !== "FOUND" ||
        m.item.status === "CLOSED"
    );
    record(
      52,
      "Phase 5C Live Same-Type & Closed Candidate Exclusion: Identical LOST report and CLOSED FOUND report never appear in matches",
      afterTwinAndClosedRes.status === 200 &&
        afterTwinMatches.length >= 2 &&
        !containsSameTypeOrClosed,
      `${afterTwinAndClosedRes.status}:${afterTwinMatches.length}`
    );

    // Case 53: Score/breakdown/reason consistency & strict public candidate field allowlist
    const ALLOWED_CANDIDATE_KEYS = new Set([
      "_id",
      "title",
      "description",
      "category",
      "type",
      "location",
      "itemDate",
      "status",
      "reportedBy",
      "createdAt",
      "updatedAt",
    ]);
    const allConsistentAndSanitized =
      afterTwinMatches.length >= 2 &&
      afterTwinMatches.every((m) => {
        const bd = m.scoreBreakdown || {};
        const sum =
          (bd.title || 0) +
          (bd.description || 0) +
          (bd.category || 0) +
          (bd.location || 0) +
          (bd.date || 0);
        const nonZeroDimensions = [
          bd.category > 0,
          bd.title > 0,
          bd.description > 0,
          bd.location > 0,
          bd.date > 0,
        ].filter(Boolean).length;
        const itemKeys = Object.keys(m.item || {});
        const onlyAllowedKeys =
          itemKeys.length === ALLOWED_CANDIDATE_KEYS.size &&
          itemKeys.every((k) => ALLOWED_CANDIDATE_KEYS.has(k));
        return (
          m.matchScore === sum &&
          Array.isArray(m.reasons) &&
          m.reasons.length === nonZeroDimensions &&
          onlyAllowedKeys
        );
      });
    record(
      53,
      "Phase 5C Breakdown & Field Allowlist: matchScore equals sum of breakdown parts, reasons match dimensions, and only 11 public fields returned",
      allConsistentAndSanitized,
      `VERIFIED:${afterTwinMatches.length}`
    );

    // Case 54: Deterministic tie-breaker ordering when two candidates have identical matchScore
    const tieSource = {
      _id: new mongoose.Types.ObjectId("660000000000000000000001"),
      title: "Black Scientific Calculator",
      description: "Casio fx-991EX calculator",
      category: "Electronics",
      type: "LOST",
      location: "Room 204",
      itemDate: new Date("2026-04-05T00:00:00.000Z"),
      status: "OPEN",
      moderated: false,
    };
    const tieCandidateOlder = {
      _id: new mongoose.Types.ObjectId("660000000000000000000002"),
      title: "Black Scientific Calculator",
      description: "Casio fx-991EX calculator",
      category: "Electronics",
      type: "FOUND",
      location: "Room 204",
      itemDate: new Date("2026-04-05T00:00:00.000Z"),
      status: "OPEN",
      moderated: false,
      createdAt: new Date("2026-04-05T08:00:00.000Z"),
    };
    const tieCandidateNewer = {
      _id: new mongoose.Types.ObjectId("660000000000000000000003"),
      title: "Black Scientific Calculator",
      description: "Casio fx-991EX calculator",
      category: "Electronics",
      type: "FOUND",
      location: "Room 204",
      itemDate: new Date("2026-04-05T00:00:00.000Z"),
      status: "OPEN",
      moderated: false,
      createdAt: new Date("2026-04-05T12:00:00.000Z"),
    };
    const orderForward = findMatchesForItem(tieSource, [
      tieCandidateOlder,
      tieCandidateNewer,
    ]);
    const orderReverse = findMatchesForItem(tieSource, [
      tieCandidateNewer,
      tieCandidateOlder,
    ]);
    record(
      54,
      "Phase 5C Deterministic Tie-Breaking: Identical-score candidates order identically regardless of input order",
      orderForward.length === 2 &&
        orderReverse.length === 2 &&
        String(orderForward[0].item._id) ===
          String(tieCandidateNewer._id) &&
        String(orderForward[0].item._id) ===
          String(orderReverse[0].item._id) &&
        String(orderForward[1].item._id) ===
          String(orderReverse[1].item._id),
      "UNIT:DETERMINISTIC"
    );

    // ── Phase 6: XP, Rewards, Badges & Leaderboard Tests ─────────────────

    // Ensure indexes on RewardEvent
    await RewardEvent.init();

    // Case 55: Unauthenticated access to /api/rewards/me and /api/rewards/preferences returns 401
    const [unauthRewardsMe, unauthRewardsPref] = await Promise.all([
      apiRequest(baseUrl, "/api/rewards/me"),
      apiRequest(baseUrl, "/api/rewards/preferences", {
        method: "PATCH",
        body: { leaderboardOptOut: true },
      }),
    ]);
    record(
      55,
      "Phase 6 Auth Guard: Unauthenticated access to /api/rewards/me and /api/rewards/preferences returns 401",
      unauthRewardsMe.status === 401 && unauthRewardsPref.status === 401,
      `${unauthRewardsMe.status}/${unauthRewardsPref.status}`
    );

    // Case 56: Unauthorized client attempts to mutate XP, level, badges, or points directly are blocked with 403
    const [tamperPostRewards, tamperPatchMe, tamperPrefXp, tamperPrefBadges] =
      await Promise.all([
        apiRequest(baseUrl, "/api/rewards", {
          method: "POST",
          token: tokenA,
          body: { xp: 9999, points: 500 },
        }),
        apiRequest(baseUrl, "/api/rewards/me", {
          method: "PATCH",
          token: tokenA,
          body: { xp: 9999, level: 99 },
        }),
        apiRequest(baseUrl, "/api/rewards/preferences", {
          method: "PATCH",
          token: tokenA,
          body: { leaderboardOptOut: false, xp: 5000 },
        }),
        apiRequest(baseUrl, "/api/rewards/preferences", {
          method: "PATCH",
          token: tokenA,
          body: {
            badges: [{ code: "FAKE_BADGE", name: "Fake", description: "x" }],
          },
        }),
      ]);
    record(
      56,
      "Phase 6 Anti-Tampering: Client attempts to directly set XP, level, points, or badges return 403",
      tamperPostRewards.status === 403 &&
        tamperPatchMe.status === 403 &&
        tamperPrefXp.status === 403 &&
        tamperPrefBadges.status === 403,
      `${tamperPostRewards.status}/${tamperPatchMe.status}/${tamperPrefXp.status}/${tamperPrefBadges.status}`
    );

    // Create dedicated Phase 6 test users for isolated XP, badge, and anti-spam verification
    const p6EmailFinder = `p6-finder-${runTag}@test.lostlink.local`;
    const p6EmailClaimant = `p6-claimant-${runTag}@test.lostlink.local`;
    const credP6Finder = createTestGoogleCredential({
      email: p6EmailFinder,
      name: "Phase6 Finder",
    });
    const credP6Claimant = createTestGoogleCredential({
      email: p6EmailClaimant,
      name: "Phase6 Claimant",
    });
    const [regP6Finder, regP6Claimant] = await Promise.all([
      apiRequest(baseUrl, "/api/auth/google", {
        method: "POST",
        body: { credential: credP6Finder },
      }),
      apiRequest(baseUrl, "/api/auth/google", {
        method: "POST",
        body: { credential: credP6Claimant },
      }),
    ]);
    const p6FinderId = regP6Finder.data?.user?.id;
    const p6ClaimantId = regP6Claimant.data?.user?.id;
    const tokenP6Finder = regP6Finder.data?.token;
    const tokenP6Claimant = regP6Claimant.data?.token;
    if (p6FinderId) createdUserIds.push(p6FinderId);
    if (p6ClaimantId) createdUserIds.push(p6ClaimantId);

    // Case 57: Report creation awards (+15 XP FOUND, +10 XP LOST), unlocks FIRST_VALID_REPORT & HELPFUL_FINDER, and enforces daily anti-spam cap (5/day)
    const p6FoundReportRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenP6Finder,
      body: {
        title: `P6 Found Titanium Watch ${runTag}`,
        description: `Found silver watch near Science Auditorium ${runTag}`,
        category: "Accessories",
        type: "FOUND",
        location: "Science Auditorium",
        itemDate: "2026-04-10T00:00:00.000Z",
      },
    });
    const p6FoundItemId = p6FoundReportRes.data?.item?._id;
    if (p6FoundItemId) createdItemIds.push(p6FoundItemId);

    const p6LostReportRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenP6Claimant,
      body: {
        title: `P6 Lost Titanium Watch ${runTag}`,
        description: `Lost silver watch near Science Auditorium ${runTag}`,
        category: "Accessories",
        type: "LOST",
        location: "Science Auditorium",
        itemDate: "2026-04-10T00:00:00.000Z",
      },
    });
    const p6LostItemId = p6LostReportRes.data?.item?._id;
    if (p6LostItemId) createdItemIds.push(p6LostItemId);

    // Submit 5 more LOST reports for p6Claimant; reports #2..#5 earn +10 XP each (total 5 rewarded reports = 50 XP), report #6 hits daily anti-spam cap (0 XP)
    const extraLostResponses = [];
    for (let i = 2; i <= 6; i += 1) {
      const r = await apiRequest(baseUrl, "/api/items", {
        method: "POST",
        token: tokenP6Claimant,
        body: {
          title: `P6 Lost Notebook #${i} ${runTag}`,
          description: `Spiral notebook lost in lecture hall ${i} ${runTag}`,
          category: "Books",
          type: "LOST",
          location: "Lecture Hall",
          itemDate: "2026-04-10T00:00:00.000Z",
        },
      });
      if (r.data?.item?._id) createdItemIds.push(r.data.item._id);
      extraLostResponses.push(r);
    }
    const sixthReportReward = extraLostResponses[4]?.data?.reward;
    const finderRewardsAfterCreate = await apiRequest(
      baseUrl,
      "/api/rewards/me",
      { token: tokenP6Finder }
    );
    const finderEarnedCodes = (
      finderRewardsAfterCreate.data?.profile?.earnedBadges || []
    ).map((b) => b.code);

    record(
      57,
      "Phase 6 Report Creation XP & Daily Cap: FOUND (+15 XP) and LOST (+10 XP) award accurately, unlock badges, and cap at 5 rewarded reports/day",
      p6FoundReportRes.status === 201 &&
        p6FoundReportRes.data?.reward?.pointsAwarded === 15 &&
        p6LostReportRes.status === 201 &&
        p6LostReportRes.data?.reward?.pointsAwarded === 10 &&
        finderRewardsAfterCreate.data?.profile?.xp === 15 &&
        finderEarnedCodes.includes("FIRST_VALID_REPORT") &&
        finderEarnedCodes.includes("HELPFUL_FINDER") &&
        sixthReportReward?.awarded === false &&
        sixthReportReward?.dailyCapReached === true &&
        sixthReportReward?.pointsAwarded === 0,
      `${p6FoundReportRes.data?.reward?.pointsAwarded}/${p6LostReportRes.data?.reward?.pointsAwarded}/CAP:${sixthReportReward?.dailyCapReached}`
    );

    // Case 58: Duplicate reward event & concurrent retry idempotency (same idempotencyKey never awards XP twice)
    const p6FoundItemDoc = await Item.findById(p6FoundItemId);
    const [concurrentRetry1, concurrentRetry2, concurrentRetry3] =
      await Promise.all([
        awardReportCreationXp({
          userId: p6FinderId,
          item: p6FoundItemDoc,
        }),
        awardReportCreationXp({
          userId: p6FinderId,
          item: p6FoundItemDoc,
        }),
        recordRewardEvent({
          userId: p6FinderId,
          eventType: "REPORT_CREATED_FOUND",
          points: 15,
          reason: "Duplicate retry attempt",
          idempotencyKey: `report_create:${p6FoundItemId}:${p6FinderId}`,
          itemId: p6FoundItemId,
        }),
      ]);
    const finderAfterRetries = await User.findById(p6FinderId);
    record(
      58,
      "Phase 6 Idempotency & Concurrency: Retrying or concurrently invoking the same reward event awards 0 duplicate XP",
      concurrentRetry1.awarded === false &&
        concurrentRetry1.pointsAwarded === 0 &&
        concurrentRetry2.awarded === false &&
        concurrentRetry2.pointsAwarded === 0 &&
        concurrentRetry3.awarded === false &&
        concurrentRetry3.pointsAwarded === 0 &&
        finderAfterRetries?.xp === 15,
      `XP:${finderAfterRetries?.xp}`
    );

    // Case 59: Self-claims (403) and REJECTED claims (200) award 0 XP and do not unlock SUCCESSFUL_RETURN
    const selfClaimAttempt = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenP6Finder,
      body: {
        itemId: p6FoundItemId,
        proofDescription: "Trying to claim my own found item for XP",
      },
    });
    const rejectedClaimSub = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenC,
      body: {
        itemId: p6FoundItemId,
        proofDescription: "Unrelated student guessing wrong watch details",
      },
    });
    const rejectedClaimId = rejectedClaimSub.data?.claim?._id;
    if (rejectedClaimId) createdClaimIds.push(rejectedClaimId);

    const rejectReviewRes = await apiRequest(
      baseUrl,
      `/api/claims/${rejectedClaimId}/review`,
      {
        method: "PATCH",
        token: tokenP6Finder,
        body: {
          status: "REJECTED",
          reviewNote: "Details did not match the watch",
        },
      }
    );
    const finderAfterReject = await User.findById(p6FinderId);
    const hasReturnBadgeAfterReject = (finderAfterReject?.badges || []).some(
      (b) => b.code === "SUCCESSFUL_RETURN"
    );
    record(
      59,
      "Phase 6 Fraud Prevention: Self-claims (403) and rejected claims (200) grant 0 XP and no return badge",
      selfClaimAttempt.status === 403 &&
        rejectReviewRes.status === 200 &&
        finderAfterReject?.xp === 15 &&
        !hasReturnBadgeAfterReject,
      `${selfClaimAttempt.status}/${rejectReviewRes.status}/XP:${finderAfterReject?.xp}`
    );

    // Case 60: Verified return awards +50 XP to finder and +15 XP to verified claimant, unlocks SUCCESSFUL_RETURN, and is idempotent on retries
    const validClaimSub = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenP6Claimant,
      body: {
        itemId: p6FoundItemId,
        proofDescription:
          "Titanium watch with engraved initials PC on the clasp and blue strap",
      },
    });
    const validClaimId = validClaimSub.data?.claim?._id;
    if (validClaimId) createdClaimIds.push(validClaimId);

    const approveReviewRes = await apiRequest(
      baseUrl,
      `/api/claims/${validClaimId}/review`,
      {
        method: "PATCH",
        token: tokenP6Finder,
        body: {
          status: "APPROVED",
          reviewNote: "Engraved initials verified in person",
        },
      }
    );
    // Retry approving the already-approved claim (409) AND call awardVerifiedReturnXp directly to test idempotency
    const retryApproveRes = await apiRequest(
      baseUrl,
      `/api/claims/${validClaimId}/review`,
      {
        method: "PATCH",
        token: tokenP6Finder,
        body: {
          status: "APPROVED",
          reviewNote: "Duplicate approval retry",
        },
      }
    );
    const directRepeatReturnCall = await awardVerifiedReturnXp({
      item: await Item.findById(p6FoundItemId),
      claim: await Claim.findById(validClaimId),
    });

    const [finderAfterApprove, claimantAfterApprove] = await Promise.all([
      apiRequest(baseUrl, "/api/rewards/me", { token: tokenP6Finder }),
      apiRequest(baseUrl, "/api/rewards/me", { token: tokenP6Claimant }),
    ]);
    const finderProfileAfterApprove = finderAfterApprove.data?.profile;
    const claimantProfileAfterApprove = claimantAfterApprove.data?.profile;

    record(
      60,
      "Phase 6 Verified Return XP: Approving claim awards +50 XP to finder (total 65) and +15 XP to claimant (total 65), unlocks SUCCESSFUL_RETURN, and blocks duplicate return XP",
      approveReviewRes.status === 200 &&
        approveReviewRes.data?.rewards?.finderReward?.pointsAwarded === 50 &&
        approveReviewRes.data?.rewards?.claimantReward?.pointsAwarded === 15 &&
        retryApproveRes.status === 409 &&
        directRepeatReturnCall.finderReward?.awarded === false &&
        directRepeatReturnCall.finderReward?.pointsAwarded === 0 &&
        finderProfileAfterApprove?.xp === 65 &&
        claimantProfileAfterApprove?.xp === 65 &&
        finderProfileAfterApprove?.earnedBadges?.some(
          (b) => b.code === "SUCCESSFUL_RETURN"
        ) &&
        claimantProfileAfterApprove?.earnedBadges?.some(
          (b) => b.code === "SUCCESSFUL_RETURN"
        ),
      `FINDER:${finderProfileAfterApprove?.xp}/CLAIMANT:${claimantProfileAfterApprove?.xp}`
    );

    // Case 61: Admin moderation or owner deletion revokes creation XP for that report and reconciles user XP
    const spamReportRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenP6Finder,
      body: {
        title: `P6 Spam Report To Moderate ${runTag}`,
        description: `Spam report that will be moderated by admin ${runTag}`,
        category: "Other",
        type: "FOUND",
        location: "Main Gate",
        itemDate: "2026-04-10T00:00:00.000Z",
      },
    });
    const spamReportId = spamReportRes.data?.item?._id;
    if (spamReportId) createdItemIds.push(spamReportId);
    const xpBeforeMod = (await User.findById(p6FinderId))?.xp; // 65 + 15 = 80

    await apiRequest(baseUrl, `/api/admin/items/${spamReportId}`, {
      method: "DELETE",
      token: tokenAdmin,
      body: { reason: "Spam report moderated in Phase 6 test" },
    });
    const xpAfterMod = (await User.findById(p6FinderId))?.xp; // Back to 65

    record(
      61,
      "Phase 6 Moderation XP Revocation: Moderating a report revokes its creation XP (80 -> 65) and reconciles user ledger",
      xpBeforeMod === 80 && xpAfterMod === 65,
      `${xpBeforeMod}->${xpAfterMod}`
    );

    // Case 62: Badge criteria & idempotency (COMMUNITY_HELPER unlocked, and repeated reconciliation preserves badge count and awardedAt)
    const claimantBadgesBefore =
      claimantProfileAfterApprove?.earnedBadges || [];
    const hasCommunityHelper = claimantBadgesBefore.some(
      (b) => b.code === "COMMUNITY_HELPER"
    ); // p6Claimant has 5 valid report rewards (>= 3 criteria)
    const firstBadgeBefore = claimantBadgesBefore.find(
      (b) => b.code === "FIRST_VALID_REPORT"
    );

    await reconcileUserRewards(p6ClaimantId);
    await reconcileUserRewards(p6ClaimantId);
    const claimantAfterReconcile = await User.findById(p6ClaimantId);
    const claimantBadgesAfter = claimantAfterReconcile?.badges || [];
    const firstBadgeAfter = claimantBadgesAfter.find(
      (b) => b.code === "FIRST_VALID_REPORT"
    );
    const uniqueBadgeCodes = new Set(claimantBadgesAfter.map((b) => b.code));

    record(
      62,
      "Phase 6 Badge Criteria & Idempotency: COMMUNITY_HELPER unlocks accurately and repeated reconciliation never duplicates badges or alters awardedAt",
      hasCommunityHelper &&
        claimantBadgesAfter.length === claimantBadgesBefore.length &&
        uniqueBadgeCodes.size === claimantBadgesAfter.length &&
        new Date(firstBadgeBefore?.awardedAt).getTime() ===
          new Date(firstBadgeAfter?.awardedAt).getTime(),
      `BADGES:${claimantBadgesAfter.length}`
    );

    // Case 63: Public leaderboard privacy, sorting, and pagination validation
    const [lbValidRes, lbBadPage, lbBadLimit, lbBadKey] = await Promise.all([
      apiRequest(baseUrl, "/api/rewards/leaderboard?page=1&limit=10"),
      apiRequest(baseUrl, "/api/rewards/leaderboard?page=0"),
      apiRequest(baseUrl, "/api/rewards/leaderboard?limit=99"),
      apiRequest(baseUrl, "/api/rewards/leaderboard?secret=1"),
    ]);
    const lbEntries = lbValidRes.data?.leaderboard || [];
    const ALLOWED_LB_KEYS = new Set([
      "rank",
      "userId",
      "displayName",
      "xp",
      "level",
      "badgeCount",
      "badges",
    ]);
    const lbSortedAndPrivate =
      lbEntries.length >= 2 &&
      !lbValidRes.text.includes("passwordHash") &&
      !lbValidRes.text.includes("@test.lostlink.local") &&
      !lbValidRes.text.includes("proofDescription") &&
      lbEntries.every((entry, idx) => {
        const keys = Object.keys(entry);
        const onlyAllowed =
          keys.length === ALLOWED_LB_KEYS.size &&
          keys.every((k) => ALLOWED_LB_KEYS.has(k));
        const sortedDesc = idx === 0 || lbEntries[idx - 1].xp >= entry.xp;
        return onlyAllowed && sortedDesc && entry.rank === idx + 1;
      });

    record(
      63,
      "Phase 6 Leaderboard Privacy & Validation: Sorted descending by XP with only public fields (no emails/hashes) and rejects invalid pagination (400)",
      lbValidRes.status === 200 &&
        lbSortedAndPrivate &&
        lbBadPage.status === 400 &&
        lbBadLimit.status === 400 &&
        lbBadKey.status === 400,
      `${lbValidRes.status}/${lbBadPage.status}/${lbBadLimit.status}/${lbBadKey.status}`
    );

    // Case 64: Leaderboard opt-out preference hides user when opted out and restores when opted back in
    const optOutRes = await apiRequest(baseUrl, "/api/rewards/preferences", {
      method: "PATCH",
      token: tokenP6Finder,
      body: { leaderboardOptOut: true },
    });
    const lbWhileOptedOut = await apiRequest(
      baseUrl,
      "/api/rewards/leaderboard?page=1&limit=50"
    );
    const finderPresentWhileOptedOut = (
      lbWhileOptedOut.data?.leaderboard || []
    ).some((entry) => String(entry.userId) === String(p6FinderId));

    const optInRes = await apiRequest(baseUrl, "/api/rewards/preferences", {
      method: "PATCH",
      token: tokenP6Finder,
      body: { leaderboardOptOut: false },
    });
    const lbAfterOptIn = await apiRequest(
      baseUrl,
      "/api/rewards/leaderboard?page=1&limit=50"
    );
    const finderPresentAfterOptIn = (
      lbAfterOptIn.data?.leaderboard || []
    ).some((entry) => String(entry.userId) === String(p6FinderId));

    record(
      64,
      "Phase 6 Leaderboard Opt-Out: Opting out removes user from public leaderboard; opting back in restores visibility",
      optOutRes.status === 200 &&
        !finderPresentWhileOptedOut &&
        optInRes.status === 200 &&
        finderPresentAfterOptIn,
      `OPT_OUT_HIDDEN:${!finderPresentWhileOptedOut}/OPT_IN_VISIBLE:${finderPresentAfterOptIn}`
    );

    // ── Phase 7: Admin Dashboard Analytics & Notifications Regression Suite ──

    await Notification.init();

    // Case 65: Admin Analytics Authorization (Unauthenticated 401, Student 403, Admin 200)
    const [unauthAnalyticsRes, studentAnalyticsRes, adminAnalyticsRes] =
      await Promise.all([
        apiRequest(baseUrl, "/api/admin/analytics"),
        apiRequest(baseUrl, "/api/admin/analytics", { token: tokenP6Finder }),
        apiRequest(baseUrl, "/api/admin/analytics", { token: tokenAdmin }),
      ]);
    record(
      65,
      "Phase 7 Admin Analytics Auth: Unauthenticated (401) and student (403) requests blocked; admin (200) succeeds",
      unauthAnalyticsRes.status === 401 &&
        studentAnalyticsRes.status === 403 &&
        adminAnalyticsRes.status === 200 &&
        adminAnalyticsRes.data?.success === true,
      `${unauthAnalyticsRes.status}/${studentAnalyticsRes.status}/${adminAnalyticsRes.status}`
    );

    // Case 66: Admin Analytics Accuracy & Privacy (totals, breakdowns, recentActivity, no passwordHash/proofDescription/reviewNote)
    const analyticsTotals = adminAnalyticsRes.data?.totals || {};
    const analyticsBreakdowns = adminAnalyticsRes.data?.breakdowns || {};
    const analyticsRecent = adminAnalyticsRes.data?.recentActivity || {};
    const analyticsAccuracyAndPrivacy =
      typeof analyticsTotals.totalUsers === "number" &&
      analyticsTotals.totalUsers >= 5 &&
      analyticsTotals.totalUsers ===
        analyticsTotals.studentUsers + analyticsTotals.adminUsers &&
      analyticsTotals.activeReports ===
        analyticsTotals.lostReports + analyticsTotals.foundReports &&
      analyticsTotals.totalReports ===
        analyticsTotals.activeReports + analyticsTotals.moderatedReports &&
      analyticsTotals.completedReturns >= 1 &&
      analyticsTotals.moderatedReports >= 1 &&
      analyticsTotals.totalXpAwarded >= 130 &&
      typeof analyticsBreakdowns.reportsByStatus?.OPEN === "number" &&
      typeof analyticsBreakdowns.claimsByStatus?.APPROVED === "number" &&
      Array.isArray(analyticsBreakdowns.reportsByCategory) &&
      Array.isArray(analyticsRecent.recentReports) &&
      Array.isArray(analyticsRecent.recentClaims) &&
      Array.isArray(analyticsRecent.recentModeration) &&
      !adminAnalyticsRes.text.includes("passwordHash") &&
      !adminAnalyticsRes.text.includes("proofDescription") &&
      !adminAnalyticsRes.text.includes("reviewNote") &&
      !adminAnalyticsRes.text.includes(secretProofText);

    record(
      66,
      "Phase 7 Admin Analytics Accuracy & Privacy: Server-derived totals/breakdowns/recentActivity match DB and never leak passwordHash or private claim proofs",
      analyticsAccuracyAndPrivacy,
      `USERS:${analyticsTotals.totalUsers}/REPORTS:${analyticsTotals.totalReports}/RETURNS:${analyticsTotals.completedReturns}`
    );

    // Case 67: Admin Analytics Query Validation (invalid recentLimit and unknown query params return 400)
    const [
      analyticsLimitZero,
      analyticsLimitOver,
      analyticsLimitNaN,
      analyticsBadKey,
    ] = await Promise.all([
      apiRequest(baseUrl, "/api/admin/analytics?recentLimit=0", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/admin/analytics?recentLimit=99", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/admin/analytics?recentLimit=abc", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/admin/analytics?foo=bar", {
        token: tokenAdmin,
      }),
    ]);
    record(
      67,
      "Phase 7 Admin Analytics Validation: Out-of-range, non-numeric recentLimit and unknown query params return 400",
      analyticsLimitZero.status === 400 &&
        analyticsLimitOver.status === 400 &&
        analyticsLimitNaN.status === 400 &&
        analyticsBadKey.status === 400,
      `${analyticsLimitZero.status}/${analyticsLimitOver.status}/${analyticsLimitNaN.status}/${analyticsBadKey.status}`
    );

    // Case 68: Notification Auth & Request Validation (Unauthenticated 401; invalid query/ID/body 400)
    const fakeNotifId = new mongoose.Types.ObjectId().toString();
    const [
      unauthNotifGet,
      unauthNotifPatchOne,
      unauthNotifPatchAll,
      badNotifUnreadParam,
      badNotifLimitParam,
      badNotifUnknownParam,
      badNotifObjectId,
      badNotifBodyOne,
      badNotifBodyAll,
    ] = await Promise.all([
      apiRequest(baseUrl, "/api/notifications"),
      apiRequest(baseUrl, `/api/notifications/${fakeNotifId}/read`, {
        method: "PATCH",
      }),
      apiRequest(baseUrl, "/api/notifications/read-all", {
        method: "PATCH",
      }),
      apiRequest(baseUrl, "/api/notifications?unreadOnly=maybe", {
        token: tokenP6Finder,
      }),
      apiRequest(baseUrl, "/api/notifications?limit=99", {
        token: tokenP6Finder,
      }),
      apiRequest(baseUrl, "/api/notifications?recipient=spoof", {
        token: tokenP6Finder,
      }),
      apiRequest(baseUrl, "/api/notifications/not-an-id/read", {
        method: "PATCH",
        token: tokenP6Finder,
      }),
      apiRequest(baseUrl, `/api/notifications/${fakeNotifId}/read`, {
        method: "PATCH",
        token: tokenP6Finder,
        body: { read: false },
      }),
      apiRequest(baseUrl, "/api/notifications/read-all", {
        method: "PATCH",
        token: tokenP6Finder,
        body: { extra: true },
      }),
    ]);
    record(
      68,
      "Phase 7 Notification Auth & Validation: Unauthenticated requests return 401; invalid query params, bad ObjectIds, and unexpected body fields return 400",
      unauthNotifGet.status === 401 &&
        unauthNotifPatchOne.status === 401 &&
        unauthNotifPatchAll.status === 401 &&
        badNotifUnreadParam.status === 400 &&
        badNotifLimitParam.status === 400 &&
        badNotifUnknownParam.status === 400 &&
        badNotifObjectId.status === 400 &&
        badNotifBodyOne.status === 400 &&
        badNotifBodyAll.status === 400,
      `401:${unauthNotifGet.status}/${unauthNotifPatchOne.status}/${unauthNotifPatchAll.status}|400:${badNotifUnreadParam.status}/${badNotifLimitParam.status}/${badNotifObjectId.status}`
    );

    // Case 69: Notification Persistence, Event Lifecycle & Privacy
    // In Phase 6 cases 59 & 60, p6Finder's item (p6FoundItemId) had:
    // - 1 claim submitted & rejected (by Student C -> CLAIM_SUBMITTED for p6Finder, CLAIM_REJECTED for Student C)
    // - 1 claim submitted & approved (by p6Claimant -> CLAIM_SUBMITTED + ITEM_RETURNED for p6Finder, CLAIM_APPROVED for p6Claimant)
    const [finderNotifRes, claimantNotifRes, studentCNotifRes] =
      await Promise.all([
        apiRequest(baseUrl, "/api/notifications", { token: tokenP6Finder }),
        apiRequest(baseUrl, "/api/notifications", { token: tokenP6Claimant }),
        apiRequest(baseUrl, "/api/notifications", { token: tokenC }),
      ]);
    const finderNotifs = finderNotifRes.data?.notifications || [];
    const claimantNotifs = claimantNotifRes.data?.notifications || [];
    const studentCNotifs = studentCNotifRes.data?.notifications || [];

    const finderHasSubmitted = finderNotifs.some(
      (n) =>
        n.type === "CLAIM_SUBMITTED" && String(n.item) === String(p6FoundItemId)
    );
    const finderHasReturned = finderNotifs.some(
      (n) =>
        n.type === "ITEM_RETURNED" && String(n.item) === String(p6FoundItemId)
    );
    const claimantHasApproved = claimantNotifs.some(
      (n) =>
        n.type === "CLAIM_APPROVED" && String(n.claim) === String(validClaimId)
    );
    const studentCHasRejected = studentCNotifs.some(
      (n) =>
        n.type === "CLAIM_REJECTED" && String(n.item) === String(p6FoundItemId)
    );
    const notifPrivacyCheck =
      !finderNotifRes.text.includes("Titanium watch with engraved initials") &&
      !claimantNotifRes.text.includes("Engraved initials verified in person") &&
      !finderNotifRes.text.includes("idempotencyKey");

    record(
      69,
      "Phase 7 Notification Lifecycle & Privacy: CLAIM_SUBMITTED, CLAIM_REJECTED, CLAIM_APPROVED, and ITEM_RETURNED persist accurately without leaking proofDescription or reviewNote",
      finderNotifRes.status === 200 &&
        claimantNotifRes.status === 200 &&
        finderHasSubmitted &&
        finderHasReturned &&
        claimantHasApproved &&
        studentCHasRejected &&
        notifPrivacyCheck,
      `FINDER:${finderNotifs.length}/CLAIMANT:${claimantNotifs.length}`
    );

    // Case 70: Duplicate Notification Prevention (Idempotency & Concurrency)
    const countBeforeDupTest = await Notification.countDocuments({
      recipient: p6FinderId,
    });
    const p6ItemDoc = await Item.findById(p6FoundItemId);
    const p6ClaimDoc = await Claim.findById(validClaimId);
    const [
      notifDupSub1,
      notifDupSub2,
      notifDupRev1,
      notifDupCustom1,
      notifDupCustom2,
    ] = await Promise.all([
      notifyClaimSubmitted({ item: p6ItemDoc, claim: p6ClaimDoc }),
      notifyClaimSubmitted({ item: p6ItemDoc, claim: p6ClaimDoc }),
      notifyClaimReviewed({
        item: p6ItemDoc,
        claim: p6ClaimDoc,
        decision: "APPROVED",
      }),
      createNotificationIfNotExists({
        recipientId: p6FinderId,
        type: "ITEM_RETURNED",
        title: "Idempotency test",
        message: "Concurrent duplicate event test",
        idempotencyKey: `notif:test_idemp:${runTag}`,
        itemId: p6FoundItemId,
      }),
      createNotificationIfNotExists({
        recipientId: p6FinderId,
        type: "ITEM_RETURNED",
        title: "Idempotency test",
        message: "Concurrent duplicate event test",
        idempotencyKey: `notif:test_idemp:${runTag}`,
        itemId: p6FoundItemId,
      }),
    ]);
    const countAfterDupTest = await Notification.countDocuments({
      recipient: p6FinderId,
    });
    const customCreatedExactlyOnce =
      (notifDupCustom1.created ? 1 : 0) + (notifDupCustom2.created ? 1 : 0) ===
      1;

    record(
      70,
      "Phase 7 Duplicate Notification Protection: Retried or concurrent identical notification events never create duplicates",
      notifDupSub1.created === false &&
        notifDupSub2.created === false &&
        notifDupRev1.claimantNotification?.created === false &&
        notifDupRev1.finderNotification?.created === false &&
        customCreatedExactlyOnce &&
        countAfterDupTest === countBeforeDupTest + 1,
      `BEFORE:${countBeforeDupTest}/AFTER:${countAfterDupTest}`
    );

    // Case 71: Notification Ownership Isolation (User B cannot read or mark User A's notification)
    const targetFinderNotifId = finderNotifs[0]?._id;
    const crossUserMarkRes = await apiRequest(
      baseUrl,
      `/api/notifications/${targetFinderNotifId}/read`,
      {
        method: "PATCH",
        token: tokenP6Claimant,
      }
    );
    const claimantSeesFinderNotif = claimantNotifs.some(
      (n) => String(n._id) === String(targetFinderNotifId)
    );
    const targetNotifAfterCrossAttempt =
      await Notification.findById(targetFinderNotifId);

    record(
      71,
      "Phase 7 Notification Ownership: User B cannot view User A's notifications or mark them read (404), leaving User A's notification unread",
      crossUserMarkRes.status === 404 &&
        !claimantSeesFinderNotif &&
        targetNotifAfterCrossAttempt?.read === false,
      `${crossUserMarkRes.status}/READ:${targetNotifAfterCrossAttempt?.read}`
    );

    // Case 72: Unread Count, unreadOnly Filter, Mark-As-Read & Mark-All-As-Read
    const finderListBeforeRead = await apiRequest(
      baseUrl,
      "/api/notifications?unreadOnly=true",
      { token: tokenP6Finder }
    );
    const initialUnreadCount = finderListBeforeRead.data?.unreadCount ?? 0;

    const markOneRes = await apiRequest(
      baseUrl,
      `/api/notifications/${targetFinderNotifId}/read`,
      {
        method: "PATCH",
        token: tokenP6Finder,
      }
    );
    // Repeat marking the same notification read (idempotent 200, unreadCount does not decrement a second time)
    const markOneRepeatRes = await apiRequest(
      baseUrl,
      `/api/notifications/${targetFinderNotifId}/read`,
      {
        method: "PATCH",
        token: tokenP6Finder,
      }
    );

    const markAllRes = await apiRequest(
      baseUrl,
      "/api/notifications/read-all",
      {
        method: "PATCH",
        token: tokenP6Finder,
      }
    );
    const [finderUnreadAfterAll, claimantUnreadAfterFinderMarkAll] =
      await Promise.all([
        apiRequest(baseUrl, "/api/notifications?unreadOnly=true", {
          token: tokenP6Finder,
        }),
        apiRequest(baseUrl, "/api/notifications?unreadOnly=true", {
          token: tokenP6Claimant,
        }),
      ]);

    record(
      72,
      "Phase 7 Mark-As-Read & Mark-All-As-Read: Single read decrements unreadCount idempotently; read-all clears remaining unread items without affecting other users",
      initialUnreadCount >= 3 &&
        markOneRes.status === 200 &&
        markOneRes.data?.notification?.read === true &&
        Boolean(markOneRes.data?.notification?.readAt) &&
        markOneRes.data?.unreadCount === initialUnreadCount - 1 &&
        markOneRepeatRes.status === 200 &&
        markOneRepeatRes.data?.unreadCount === initialUnreadCount - 1 &&
        markAllRes.status === 200 &&
        markAllRes.data?.unreadCount === 0 &&
        finderUnreadAfterAll.data?.unreadCount === 0 &&
        finderUnreadAfterAll.data?.notifications?.length === 0 &&
        (claimantUnreadAfterFinderMarkAll.data?.unreadCount ?? 0) >= 1,
      `UNREAD:${initialUnreadCount}->${markOneRes.data?.unreadCount}->${finderUnreadAfterAll.data?.unreadCount}`
    );

    // ── Phase 8: Security & Reliability Hardening Regression Suite ────────────

    // Case 73: Security Headers & API 404 Handler
    const unknownApiRes = await apiRequest(
      baseUrl,
      "/api/nonexistent-endpoint-check"
    );
    const hasNosniff =
      unknownApiRes.headers?.get("x-content-type-options") === "nosniff";
    const hasFrameDeny =
      unknownApiRes.headers?.get("x-frame-options") === "DENY";
    const hasReferrerPolicy =
      unknownApiRes.headers?.get("referrer-policy") ===
      "strict-origin-when-cross-origin";
    const noPoweredBy = !unknownApiRes.headers?.get("x-powered-by");

    record(
      73,
      "Phase 8 Security Headers & API 404: Sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy, hides X-Powered-By, and returns JSON 404 on unknown API routes",
      unknownApiRes.status === 404 &&
        unknownApiRes.data?.success === false &&
        unknownApiRes.data?.message === "API endpoint not found" &&
        hasNosniff &&
        hasFrameDeny &&
        hasReferrerPolicy &&
        noPoweredBy,
      `${unknownApiRes.status}/HEADERS:${hasNosniff && hasFrameDeny && noPoweredBy}`
    );

    // Case 74: Rate Limiter Middleware Enforcement (200 within window, 429 + Retry-After when exceeded)
    const rl1 = await apiRequest(baseUrl, "/api/test-rate-limit");
    const rl2 = await apiRequest(baseUrl, "/api/test-rate-limit");
    const rl3 = await apiRequest(baseUrl, "/api/test-rate-limit");
    const rl4 = await apiRequest(baseUrl, "/api/test-rate-limit");
    record(
      74,
      "Phase 8 Rate Limiting: Allows requests within threshold (200) and blocks excess requests with 429 and Retry-After header",
      rl1.status === 200 &&
        rl2.status === 200 &&
        rl3.status === 200 &&
        rl4.status === 429 &&
        rl4.data?.success === false &&
        Boolean(rl4.headers?.get("retry-after")) &&
        rl4.headers?.get("x-ratelimit-remaining") === "0",
      `${rl1.status}/${rl2.status}/${rl3.status}/${rl4.status}`
    );

    // Case 75: Strict Item Type & Date Range Validation (POST /api/items & PATCH /api/items/:id)
    const [
      nonStringTitlePost,
      arrayLocationPost,
      farFutureDatePost,
      pre2000DatePost,
      nonStringTitlePatch,
      farFutureDatePatch,
    ] = await Promise.all([
      apiRequest(baseUrl, "/api/items", {
        method: "POST",
        token: tokenA,
        body: {
          title: 123456,
          description: "Valid description text",
          category: "Electronics",
          type: "LOST",
          location: "Library",
          itemDate: "2026-04-10T00:00:00.000Z",
        },
      }),
      apiRequest(baseUrl, "/api/items", {
        method: "POST",
        token: tokenA,
        body: {
          title: "Valid Title",
          description: "Valid description text",
          category: "Electronics",
          type: "LOST",
          location: ["Library", "Lab"],
          itemDate: "2026-04-10T00:00:00.000Z",
        },
      }),
      apiRequest(baseUrl, "/api/items", {
        method: "POST",
        token: tokenA,
        body: {
          title: "Valid Title",
          description: "Valid description text",
          category: "Electronics",
          type: "LOST",
          location: "Library",
          itemDate: "2099-01-01T00:00:00.000Z",
        },
      }),
      apiRequest(baseUrl, "/api/items", {
        method: "POST",
        token: tokenA,
        body: {
          title: "Valid Title",
          description: "Valid description text",
          category: "Electronics",
          type: "LOST",
          location: "Library",
          itemDate: "1995-01-01T00:00:00.000Z",
        },
      }),
      apiRequest(baseUrl, `/api/items/${p6LostItemId}`, {
        method: "PATCH",
        token: tokenP6Claimant,
        body: { title: ["Not", "A", "String"] },
      }),
      apiRequest(baseUrl, `/api/items/${p6LostItemId}`, {
        method: "PATCH",
        token: tokenP6Claimant,
        body: { itemDate: "2099-12-31T00:00:00.000Z" },
      }),
    ]);

    record(
      75,
      "Phase 8 Strict Item Type & Date Validation: Rejects non-string fields (numbers/arrays) and out-of-range itemDate values (pre-2000 or >7d future) with 400",
      nonStringTitlePost.status === 400 &&
        arrayLocationPost.status === 400 &&
        farFutureDatePost.status === 400 &&
        pre2000DatePost.status === 400 &&
        nonStringTitlePatch.status === 400 &&
        farFutureDatePatch.status === 400,
      `POST:${nonStringTitlePost.status}/${arrayLocationPost.status}/${farFutureDatePost.status}|PATCH:${nonStringTitlePatch.status}/${farFutureDatePatch.status}`
    );

    // Case 76: Claims Scope & Query Parameter Hardening Across Protected Endpoints
    const [
      studentScopeAllRes,
      adminScopeAllRes,
      badClaimsScopeRes,
      badClaimsMineQueryRes,
      badItemsMineQueryRes,
      badRewardsMeQueryRes,
      badAuthMeQueryRes,
    ] = await Promise.all([
      apiRequest(baseUrl, "/api/claims/received?scope=all", { token: tokenA }),
      apiRequest(baseUrl, "/api/claims/received?scope=all", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/claims/received?scope=invalid", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/claims/mine?unexpected=1", { token: tokenA }),
      apiRequest(baseUrl, "/api/items/mine?unexpected=1", { token: tokenA }),
      apiRequest(baseUrl, "/api/rewards/me?unexpected=1", { token: tokenA }),
      apiRequest(baseUrl, "/api/auth/me?unexpected=1", { token: tokenA }),
    ]);

    record(
      76,
      "Phase 8 Scope & Query Hardening: Student ?scope=all blocked (403), admin ?scope=all allowed (200), invalid scope/unexpected query params rejected (400)",
      studentScopeAllRes.status === 403 &&
        adminScopeAllRes.status === 200 &&
        badClaimsScopeRes.status === 400 &&
        badClaimsMineQueryRes.status === 400 &&
        badItemsMineQueryRes.status === 400 &&
        badRewardsMeQueryRes.status === 400 &&
        badAuthMeQueryRes.status === 400,
      `403:${studentScopeAllRes.status}/200:${adminScopeAllRes.status}/400:${badClaimsScopeRes.status},${badClaimsMineQueryRes.status},${badItemsMineQueryRes.status}`
    );

    // Case 77: Admin Query & Review/Moderation Body Type Validation
    const [
      adminBadQueryKey,
      adminBadIncludeMod,
      adminBadLimit,
      adminNonStringReason,
      claimNonStringReviewNote,
    ] = await Promise.all([
      apiRequest(baseUrl, "/api/admin/items?unknownKey=1", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/admin/items?includeModerated=maybe", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, "/api/admin/items?limit=999", {
        token: tokenAdmin,
      }),
      apiRequest(baseUrl, `/api/admin/items/${p6LostItemId}`, {
        method: "DELETE",
        token: tokenAdmin,
        body: { reason: ["array-not-string"] },
      }),
      apiRequest(baseUrl, `/api/claims/${validClaimId}/review`, {
        method: "PATCH",
        token: tokenP6Finder,
        body: { status: "REJECTED", reviewNote: { nested: "object" } },
      }),
    ]);

    record(
      77,
      "Phase 8 Admin & Review Type Validation: Rejects invalid /api/admin/items query params, non-string moderation reason, and non-string reviewNote with 400",
      adminBadQueryKey.status === 400 &&
        adminBadIncludeMod.status === 400 &&
        adminBadLimit.status === 400 &&
        adminNonStringReason.status === 400 &&
        claimNonStringReviewNote.status === 400,
      `${adminBadQueryKey.status}/${adminBadIncludeMod.status}/${adminBadLimit.status}/${adminNonStringReason.status}/${claimNonStringReviewNote.status}`
    );

    // Case 78: Moderation Data Integrity & Notification Cascade (Auto-rejects pending claims + notifies owner & claimant)
    const modCascadeItemRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P8 Moderation Cascade Item ${runTag}`,
        description: `Found item that will receive a claim and then be moderated ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Engineering Quad",
        itemDate: "2026-04-12T00:00:00.000Z",
      },
    });
    const modCascadeItemId = modCascadeItemRes.data?.item?._id;
    if (modCascadeItemId) createdItemIds.push(modCascadeItemId);

    const modCascadeClaimRes = await apiRequest(baseUrl, "/api/claims", {
      method: "POST",
      token: tokenB,
      body: {
        itemId: modCascadeItemId,
        proofDescription:
          "Pending claim on item that will be moderated by admin",
      },
    });
    const modCascadeClaimId = modCascadeClaimRes.data?.claim?._id;
    if (modCascadeClaimId) createdClaimIds.push(modCascadeClaimId);

    const moderateWithPendingRes = await apiRequest(
      baseUrl,
      `/api/admin/items/${modCascadeItemId}`,
      {
        method: "DELETE",
        token: tokenAdmin,
        body: { reason: "Duplicate report removed during moderation audit" },
      }
    );

    const [strandedClaimAfterMod, ownerNotifsAfterMod, claimantNotifsAfterMod] =
      await Promise.all([
        Claim.findById(modCascadeClaimId),
        apiRequest(baseUrl, "/api/notifications", { token: tokenA }),
        apiRequest(baseUrl, "/api/notifications", { token: tokenB }),
      ]);

    const ownerGotModNotif = (
      ownerNotifsAfterMod.data?.notifications || []
    ).some(
      (n) =>
        n.type === "REPORT_MODERATED" &&
        String(n.item) === String(modCascadeItemId)
    );
    const claimantGotRejectNotif = (
      claimantNotifsAfterMod.data?.notifications || []
    ).some(
      (n) =>
        n.type === "CLAIM_REJECTED" &&
        String(n.claim) === String(modCascadeClaimId)
    );

    record(
      78,
      "Phase 8 Moderation Data Integrity: Moderating a report auto-rejects pending claims, notifies claimant (CLAIM_REJECTED), and notifies report owner (REPORT_MODERATED)",
      moderateWithPendingRes.status === 200 &&
        moderateWithPendingRes.data?.autoRejectedClaims === 1 &&
        strandedClaimAfterMod?.status === "REJECTED" &&
        ownerGotModNotif &&
        claimantGotRejectNotif,
      `STATUS:${strandedClaimAfterMod?.status}/OWNER_NOTIF:${ownerGotModNotif}/CLAIMANT_NOTIF:${claimantGotRejectNotif}`
    );

    // Case 79: Competing Claim Auto-Rejection Notification (Approving Claim 1 notifies Claim 2 claimant of auto-rejection)
    const competingItemRes = await apiRequest(baseUrl, "/api/items", {
      method: "POST",
      token: tokenA,
      body: {
        title: `P8 Competing Claims Headphones ${runTag}`,
        description: `Found black headphones in Media Lab ${runTag}`,
        category: "Electronics",
        type: "FOUND",
        location: "Media Lab",
        itemDate: "2026-04-12T00:00:00.000Z",
      },
    });
    const competingItemId = competingItemRes.data?.item?._id;
    if (competingItemId) createdItemIds.push(competingItemId);

    const [compClaimBRes, compClaimCRes] = await Promise.all([
      apiRequest(baseUrl, "/api/claims", {
        method: "POST",
        token: tokenB,
        body: {
          itemId: competingItemId,
          proofDescription:
            "Serial number SN-998877 on inside left headband with braided cable",
        },
      }),
      apiRequest(baseUrl, "/api/claims", {
        method: "POST",
        token: tokenC,
        body: {
          itemId: competingItemId,
          proofDescription:
            "I think these might be my black headphones from last week",
        },
      }),
    ]);
    const compClaimBId = compClaimBRes.data?.claim?._id;
    const compClaimCId = compClaimCRes.data?.claim?._id;
    if (compClaimBId) createdClaimIds.push(compClaimBId);
    if (compClaimCId) createdClaimIds.push(compClaimCId);

    const approveCompBRes = await apiRequest(
      baseUrl,
      `/api/claims/${compClaimBId}/review`,
      {
        method: "PATCH",
        token: tokenA,
        body: {
          status: "APPROVED",
          reviewNote: "Exact serial number matched",
        },
      }
    );

    const [compClaimCAfter, studentCNotifsAfterComp] = await Promise.all([
      Claim.findById(compClaimCId),
      apiRequest(baseUrl, "/api/notifications", { token: tokenC }),
    ]);
    const studentCGotAutoRejectNotif = (
      studentCNotifsAfterComp.data?.notifications || []
    ).some(
      (n) =>
        n.type === "CLAIM_REJECTED" && String(n.claim) === String(compClaimCId)
    );

    record(
      79,
      "Phase 8 Competing Claim Notification: Approving one claim auto-rejects competing pending claims and sends CLAIM_REJECTED notifications to competing claimants",
      approveCompBRes.status === 200 &&
        compClaimCAfter?.status === "REJECTED" &&
        studentCGotAutoRejectNotif,
      `CLAIM_C:${compClaimCAfter?.status}/NOTIFIED:${studentCGotAutoRejectNotif}`
    );

    // Case 80: Self-Report Privacy & Moderated/Non-Open Delete Guards
    const [myReportsARes, deleteModeratedByOwnerRes, deleteReturnedByOwnerRes] =
      await Promise.all([
        apiRequest(baseUrl, "/api/items/mine", { token: tokenA }),
        apiRequest(baseUrl, `/api/items/${modCascadeItemId}`, {
          method: "DELETE",
          token: tokenA,
        }),
        apiRequest(baseUrl, `/api/items/${competingItemId}`, {
          method: "DELETE",
          token: tokenA,
        }),
      ]);

    record(
      80,
      "Phase 8 Self-Report Privacy & Delete Guards: /api/items/mine omits moderatedBy admin IDs; owner cannot delete moderated (404) or RETURNED (409) reports",
      myReportsARes.status === 200 &&
        !myReportsARes.text.includes("moderatedBy") &&
        deleteModeratedByOwnerRes.status === 404 &&
        deleteReturnedByOwnerRes.status === 409,
      `MINE:${myReportsARes.status}/DEL_MOD:${deleteModeratedByOwnerRes.status}/DEL_RET:${deleteReturnedByOwnerRes.status}`
    );

    // Case 81: Password registration endpoint (/api/auth/register) is disabled and returns HTTP 403 Forbidden
    const disabledRegAttempt = await apiRequest(baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Blocked User",
        email: `blocked-${runTag}@test.lostlink.local`,
        password: "Password123!",
      },
    });
    record(
      81,
      "Password registration (/api/auth/register) is disabled and returns 403",
      disabledRegAttempt.status === 403 &&
        disabledRegAttempt.data?.success === false &&
        disabledRegAttempt.data?.message?.includes("disabled"),
      disabledRegAttempt.status
    );

    // Case 82: Password login endpoint (/api/auth/login) is disabled and returns HTTP 403 Forbidden
    const disabledLoginAttempt = await apiRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: {
        email: studentAEmail,
        password: testPassword,
      },
    });
    record(
      82,
      "Password login (/api/auth/login) is disabled and returns 403",
      disabledLoginAttempt.status === 403 &&
        disabledLoginAttempt.data?.success === false &&
        disabledLoginAttempt.data?.message?.includes("disabled"),
      disabledLoginAttempt.status
    );

    // Case 83: Google token verification with official library rejects invalid or forged ID tokens with HTTP 401
    const invalidGoogleTokenRes = await apiRequest(
      baseUrl,
      "/api/auth/google",
      {
        method: "POST",
        body: { credential: "forged.unverified.google-token-credential" },
      }
    );
    record(
      83,
      "Official Google token verification rejects forged/invalid tokens with 401",
      invalidGoogleTokenRes.status === 401 &&
        invalidGoogleTokenRes.data?.success === false,
      invalidGoogleTokenRes.status
    );

    // Case 84: Google token verification rejects audience mismatch with HTTP 401
    const badAudCred = createTestGoogleCredential({
      email: `bad-aud-${runTag}@test.lostlink.local`,
      aud: "unauthorized-audience.apps.googleusercontent.com",
    });
    const badAudRes = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: badAudCred },
    });
    record(
      84,
      "Google token verification rejects audience mismatch with 401",
      badAudRes.status === 401 &&
        badAudRes.data?.message?.includes("audience mismatch"),
      badAudRes.status
    );

    // Case 85: Google token verification rejects unverified Google account email with HTTP 401
    const unverifiedEmailCred = createTestGoogleCredential({
      email: `unverified-${runTag}@test.lostlink.local`,
      email_verified: false,
    });
    const unverifiedEmailRes = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: unverifiedEmailCred },
    });
    record(
      85,
      "Google token verification rejects unverified email with 401",
      unverifiedEmailRes.status === 401 &&
        unverifiedEmailRes.data?.message?.includes("verified"),
      unverifiedEmailRes.status
    );

    // Case 86: Existing admin signing in with Google retains role='admin' and can access admin endpoints
    const adminGoogleLoginCred = createTestGoogleCredential({
      email: adminEmail,
      name: "Test Admin",
    });
    const adminGoogleLoginRes = await apiRequest(baseUrl, "/api/auth/google", {
      method: "POST",
      body: { credential: adminGoogleLoginCred },
    });
    const adminReauthAnalyticsRes = await apiRequest(
      baseUrl,
      "/api/admin/analytics",
      {
        token: adminGoogleLoginRes.data?.token,
      }
    );
    record(
      86,
      "Existing admin preserves role='admin' upon Google login and retains full admin access",
      adminGoogleLoginRes.status === 200 &&
        adminGoogleLoginRes.data?.user?.role === "admin" &&
        adminReauthAnalyticsRes.status === 200 &&
        adminReauthAnalyticsRes.data?.success === true,
      `${adminGoogleLoginRes.status}/${adminReauthAnalyticsRes.status}`
    );
  } finally {
    // Clean up ONLY test records created by this run
    if (
      createdUserIds.length > 0 ||
      createdItemIds.length > 0 ||
      createdClaimIds.length > 0
    ) {
      await Notification.deleteMany({
        $or: [
          { recipient: { $in: createdUserIds } },
          { item: { $in: createdItemIds } },
          { claim: { $in: createdClaimIds } },
        ],
      });
    }
    if (createdUserIds.length > 0 || createdItemIds.length > 0) {
      await RewardEvent.deleteMany({
        $or: [
          { user: { $in: createdUserIds } },
          { item: { $in: createdItemIds } },
        ],
      });
    }
    if (createdClaimIds.length > 0 || createdItemIds.length > 0) {
      await Claim.deleteMany({
        $or: [
          { _id: { $in: createdClaimIds } },
          { item: { $in: createdItemIds } },
        ],
      });
    }
    if (createdItemIds.length > 0) {
      await Item.deleteMany({ _id: { $in: createdItemIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  }

  console.log("\n=== PHASE 2E SECURITY & REGRESSION TEST RESULTS ===");
  let failed = 0;
  for (const r of results) {
    if (r.outcome !== "PASS") failed += 1;
    console.log(
      `[Case ${String(r.id).padStart(2, "0")}] ${r.outcome} (HTTP ${r.statusObserved}) - ${r.name}`
    );
  }
  console.log(
    `=== SUMMARY: ${results.length - failed}/${results.length} PASSED, ${failed} FAILED ===`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
