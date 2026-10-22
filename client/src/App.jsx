import { useCallback, useEffect, useRef, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const CAMPUS_NAME =
  import.meta.env.VITE_CAMPUS_NAME || "SmartCampus University";
const CONTACT_EMAIL =
  import.meta.env.VITE_CONTACT_EMAIL || "lostandfound@campus.edu";

const CATEGORIES = [
  "Electronics",
  "Documents",
  "Bags",
  "Clothing",
  "Accessories",
  "Books",
  "Keys",
  "Other",
];

const ITEM_STATUSES = [
  "OPEN",
  "MATCHED",
  "CLAIM_PENDING",
  "RETURNED",
  "CLOSED",
];

function getToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createEmptyForm() {
  return {
    title: "",
    description: "",
    category: "Electronics",
    type: "LOST",
    location: "",
    itemDate: getToday(),
  };
}

function App() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(createEmptyForm());
  const [auth, setAuth] = useState(null);
  const [myItems, setMyItems] = useState([]);
  const [showMyReports, setShowMyReports] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminItems, setAdminItems] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminUnauthorized, setAdminUnauthorized] = useState(false);
  const [adminStatusFilter, setAdminStatusFilter] = useState("");
  const [includeModerated, setIncludeModerated] = useState(true);
  const [moderatingId, setModeratingId] = useState("");
  const [showClaimsPanel, setShowClaimsPanel] = useState(false);
  const [myClaims, setMyClaims] = useState([]);
  const [receivedClaims, setReceivedClaims] = useState([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState("");
  const [adminClaimsScope, setAdminClaimsScope] = useState("all");
  const [claimingItemId, setClaimingItemId] = useState("");
  const [claimProofText, setClaimProofText] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [reviewingClaimId, setReviewingClaimId] = useState("");
  const [openMatchItemIds, setOpenMatchItemIds] = useState({});
  const [matchesByItem, setMatchesByItem] = useState({});
  const matchRequestIdRef = useRef({});
  const matchInFlightRef = useRef({});
  const matchSessionEpochRef = useRef(0);

  // Phase 6: XP, rewards, badges, and leaderboard state
  const [showRewardsPanel, setShowRewardsPanel] = useState(false);
  const [rewardProfile, setRewardProfile] = useState(null);
  const [rewardHistory, setRewardHistory] = useState([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardPagination, setLeaderboardPagination] = useState({
    totalUsers: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [updatingOptOut, setUpdatingOptOut] = useState(false);

  // Phase 7: Notifications & Admin Analytics state
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsUnreadOnly, setNotificationsUnreadOnly] = useState(false);
  const [markingNotificationId, setMarkingNotificationId] = useState("");
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [adminAnalytics, setAdminAnalytics] = useState(null);
  const [adminAnalyticsLoading, setAdminAnalyticsLoading] = useState(false);
  const [adminAnalyticsError, setAdminAnalyticsError] = useState("");

  // UI Navigation, Inline Edit & Detail Expansion state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState({});
  const [editingItemId, setEditingItemId] = useState("");
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    category: "Electronics",
    type: "LOST",
    location: "",
    itemDate: getToday(),
  });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Phase 3: Search, filters, sorting, and pagination state
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [debouncedLocation, setDebouncedLocation] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    totalItems: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [publicStats, setPublicStats] = useState(null);
  const latestRequestRef = useRef(0);

  // Debounce text inputs (search and location) by 300ms and reset to page 1
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLocation(locationInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [locationInput]);

  const loadItems = useCallback(async () => {
    const requestId = ++latestRequestRef.current;
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (filterType) params.set("type", filterType);
      if (filterCategory) params.set("category", filterCategory);
      if (debouncedLocation) params.set("location", debouncedLocation);
      if (filterStatus) params.set("status", filterStatus);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (sortBy) params.set("sort", sortBy);
      params.set("page", String(page));
      params.set("limit", "10");

      const response = await fetch(
        `${API_URL}/api/items?${params.toString()}`
      );
      const data = await response.json().catch(() => null);

      // Prevent stale responses from overwriting newer search/filter state
      if (requestId !== latestRequestRef.current) {
        return;
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not load item reports.");
      }

      setItems(Array.isArray(data.items) ? data.items : []);
      if (data.pagination) {
        setPagination(data.pagination);
      } else {
        setPagination({
          totalItems: data.items.length,
          currentPage: 1,
          pageSize: data.items.length || 10,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        });
      }
      if (data.stats) {
        setPublicStats(data.stats);
      }
      setError("");
    } catch (err) {
      if (requestId !== latestRequestRef.current) {
        return;
      }
      setError(
        err.message || "Unable to load reports. Check your backend."
      );
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }, [
    debouncedSearch,
    filterType,
    filterCategory,
    debouncedLocation,
    filterStatus,
    dateFrom,
    dateTo,
    sortBy,
    page,
  ]);

  function handleClearFilters() {
    setSearchInput("");
    setDebouncedSearch("");
    setLocationInput("");
    setDebouncedLocation("");
    setFilterType("");
    setFilterCategory("");
    setFilterStatus("");
    setDateFrom("");
    setDateTo("");
    setSortBy("newest");
    setPage(1);
    setError("");
  }

  const hasActiveFilters = Boolean(
    searchInput.trim() ||
      locationInput.trim() ||
      filterType ||
      filterCategory ||
      filterStatus ||
      dateFrom ||
      dateTo ||
      sortBy !== "newest"
  );

  async function fetchMyItems() {
    if (!auth?.token) {
      throw new Error("Please sign in to view your reports.");
    }

    const sessionEpoch = matchSessionEpochRef.current;

    const response = await fetch(`${API_URL}/api/items/mine`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    const data = await response.json().catch(() => null);

    if (sessionEpoch !== matchSessionEpochRef.current) {
      return;
    }

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || "Could not load your reports.");
    }

    setMyItems(Array.isArray(data.items) ? data.items : []);
  }

async function loadMyReports() {
  setError("");
  setNotice("");
  setShowAdminPanel(false);
  setShowClaimsPanel(false);
  setShowRewardsPanel(false);
  setShowNotificationsPanel(false);

  try {
    await fetchMyItems();
    setShowMyReports(true);
  } catch (err) {
    setError(err.message || "Could not load your reports.");
  }
}

  const fetchClaimsData = useCallback(
    async (scopeOverride = adminClaimsScope) => {
      if (!auth?.token) return;

      const sessionEpoch = matchSessionEpochRef.current;
      setClaimsLoading(true);
      setClaimsError("");

      try {
        const receivedUrl =
          auth.user?.role === "admin" && scopeOverride === "all"
            ? `${API_URL}/api/claims/received?scope=all`
            : `${API_URL}/api/claims/received`;

        const [mineRes, receivedRes] = await Promise.all([
          fetch(`${API_URL}/api/claims/mine`, {
            headers: { Authorization: `Bearer ${auth.token}` },
          }),
          fetch(receivedUrl, {
            headers: { Authorization: `Bearer ${auth.token}` },
          }),
        ]);

        const [mineData, receivedData] = await Promise.all([
          mineRes.json().catch(() => null),
          receivedRes.json().catch(() => null),
        ]);

        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }

        if (!mineRes.ok || !mineData?.success) {
          throw new Error(
            mineData?.message || "Could not load your submitted claims."
          );
        }

        if (!receivedRes.ok || !receivedData?.success) {
          throw new Error(
            receivedData?.message || "Could not load incoming claims."
          );
        }

        setMyClaims(mineData.claims || []);
        setReceivedClaims(receivedData.claims || []);
      } catch (err) {
        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }
        setClaimsError(err.message || "Could not load claims.");
      } finally {
        if (sessionEpoch === matchSessionEpochRef.current) {
          setClaimsLoading(false);
        }
      }
    },
    [auth?.token, auth?.user?.role, adminClaimsScope]
  );

  async function openClaimsPanel() {
    setError("");
    setNotice("");
    setShowAdminPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setShowClaimsPanel(true);
    await fetchClaimsData(adminClaimsScope);
  }

  async function handleSubmitClaim(event, itemId) {
    event.preventDefault();
    if (!auth?.token) return;

    const trimmedProof = claimProofText.trim();
    if (trimmedProof.length < 10) {
      setError(
        "Please provide at least 10 characters of identifying details."
      );
      return;
    }

    setClaimSubmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/api/claims`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          itemId,
          proofDescription: trimmedProof,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not submit claim.");
      }

      setClaimingItemId("");
      setClaimProofText("");
      setMatchesByItem({});
      setNotice("Claim submitted! You can track its status in Claims.");
      await loadItems();
      if (showClaimsPanel) {
        await fetchClaimsData(adminClaimsScope);
      }
      if (auth?.token) {
        await fetchNotifications(auth.token);
      }
      if (showAdminPanel && auth?.user?.role === "admin") {
        await fetchAdminAnalytics(auth.token);
      }
    } catch (err) {
      setError(err.message || "Could not submit claim.");
    } finally {
      setClaimSubmitting(false);
    }
  }

  async function handleReviewClaim(claim, decision) {
    if (!auth?.token) return;

    const defaultNote =
      decision === "APPROVED"
        ? "Identifying details matched. Ready for handover."
        : "Identifying details did not match the item.";

    const promptMessage =
      decision === "APPROVED"
        ? `Approve claim for "${claim.item?.title || "item"}" and mark the report as RETURNED?\n(Other pending claims for this item will be automatically rejected.)\n\nOptional review note (max 500 chars):`
        : `Reject claim for "${claim.item?.title || "item"}"?\n\nOptional review note (max 500 chars):`;

    const note = window.prompt(promptMessage, defaultNote);

    if (note === null) return;

    setReviewingClaimId(claim._id);
    setClaimsError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_URL}/api/claims/${claim._id}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            status: decision,
            reviewNote: note.trim(),
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not review claim.");
      }

      setMatchesByItem({});
      const finderBonus =
        decision === "APPROVED" && data.rewards?.finderReward?.awarded
          ? ` (+${data.rewards.finderReward.pointsAwarded} XP awarded to finder)`
          : "";
      setNotice(
        `${data.message || `Claim ${decision.toLowerCase()}.`}${finderBonus}`
      );
      await fetchClaimsData(adminClaimsScope);
      await loadItems();
      if (auth?.token) {
        await Promise.all([
          fetchMyRewards(auth.token),
          fetchNotifications(auth.token),
        ]);
      }
      if (showRewardsPanel) {
        await fetchLeaderboard(leaderboardPage);
      }
      if (showAdminPanel && auth?.user?.role === "admin") {
        await fetchAdminAnalytics(auth.token);
      }
    } catch (err) {
      setClaimsError(err.message || "Could not review claim.");
    } finally {
      setReviewingClaimId("");
    }
  }

  const fetchMyRewards = useCallback(
    async (tokenOverride) => {
      const activeToken = tokenOverride || auth?.token;
      if (!activeToken) {
        setRewardProfile(null);
        setRewardHistory([]);
        return;
      }

      const sessionEpoch = matchSessionEpochRef.current;
      setRewardsLoading(true);
      setRewardsError("");

      try {
        const response = await fetch(`${API_URL}/api/rewards/me`, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });
        const data = await response.json().catch(() => null);

        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || "Could not load your XP and badge profile."
          );
        }

        setRewardProfile(data.profile || null);
        setRewardHistory(Array.isArray(data.history) ? data.history : []);
      } catch (err) {
        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }
        setRewardsError(
          err.message || "Could not load your XP and badge profile."
        );
      } finally {
        if (sessionEpoch === matchSessionEpochRef.current) {
          setRewardsLoading(false);
        }
      }
    },
    [auth?.token]
  );

  const fetchLeaderboard = useCallback(
    async (targetPage = leaderboardPage) => {
      setLeaderboardLoading(true);
      setLeaderboardError("");

      try {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("limit", "10");

        const response = await fetch(
          `${API_URL}/api/rewards/leaderboard?${params.toString()}`
        );
        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || "Could not load campus leaderboard."
          );
        }

        setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
        if (data.pagination) {
          setLeaderboardPagination(data.pagination);
          setLeaderboardPage(data.pagination.currentPage || targetPage);
        }
      } catch (err) {
        setLeaderboardError(
          err.message || "Could not load campus leaderboard."
        );
      } finally {
        setLeaderboardLoading(false);
      }
    },
    [leaderboardPage]
  );

  async function openRewardsPanel() {
    setError("");
    setNotice("");
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowNotificationsPanel(false);
    setShowRewardsPanel(true);
    await Promise.all([
      auth?.token ? fetchMyRewards(auth.token) : Promise.resolve(),
      fetchLeaderboard(1),
    ]);
  }

  const fetchNotifications = useCallback(
    async (tokenOverride, unreadFilter = notificationsUnreadOnly) => {
      const activeToken = tokenOverride || auth?.token;
      if (!activeToken) {
        setNotifications([]);
        setUnreadNotificationCount(0);
        return;
      }

      const sessionEpoch = matchSessionEpochRef.current;
      setNotificationsLoading(true);
      setNotificationsError("");

      try {
        const params = new URLSearchParams();
        if (unreadFilter) {
          params.set("unreadOnly", "true");
        }
        params.set("limit", "20");

        const response = await fetch(
          `${API_URL}/api/notifications?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${activeToken}`,
            },
          }
        );

        const data = await response.json().catch(() => null);

        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || "Could not load your notifications."
          );
        }

        setNotifications(
          Array.isArray(data.notifications) ? data.notifications : []
        );
        setUnreadNotificationCount(
          typeof data.unreadCount === "number" ? data.unreadCount : 0
        );
      } catch (err) {
        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }
        setNotificationsError(
          err.message || "Could not load your notifications."
        );
      } finally {
        if (sessionEpoch === matchSessionEpochRef.current) {
          setNotificationsLoading(false);
        }
      }
    },
    [auth?.token, notificationsUnreadOnly]
  );

  async function openNotificationsPanel() {
    setError("");
    setNotice("");
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(true);
    await fetchNotifications(auth?.token, notificationsUnreadOnly);
  }

  async function handleMarkNotificationRead(notificationId) {
    if (!auth?.token || !notificationId) return;

    setMarkingNotificationId(notificationId);
    setNotificationsError("");

    try {
      const response = await fetch(
        `${API_URL}/api/notifications/${notificationId}/read`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${auth.token}`,
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not mark notification as read."
        );
      }

      await fetchNotifications(auth.token, notificationsUnreadOnly);
    } catch (err) {
      setNotificationsError(
        err.message || "Could not mark notification as read."
      );
    } finally {
      setMarkingNotificationId("");
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!auth?.token) return;

    setMarkingAllRead(true);
    setNotificationsError("");

    try {
      const response = await fetch(`${API_URL}/api/notifications/read-all`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not mark all notifications as read."
        );
      }

      setNotice(data.message || "All notifications marked as read.");
      await fetchNotifications(auth.token, notificationsUnreadOnly);
    } catch (err) {
      setNotificationsError(
        err.message || "Could not mark all notifications as read."
      );
    } finally {
      setMarkingAllRead(false);
    }
  }

  const fetchAdminAnalytics = useCallback(
    async (tokenOverride) => {
      const activeToken = tokenOverride || auth?.token;
      if (!activeToken) {
        setAdminAnalytics(null);
        return;
      }

      const sessionEpoch = matchSessionEpochRef.current;
      setAdminAnalyticsLoading(true);
      setAdminAnalyticsError("");

      try {
        const response = await fetch(`${API_URL}/api/admin/analytics`, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });

        const data = await response.json().catch(() => null);

        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setAdminUnauthorized(true);
          throw new Error(data?.message || "Admin access required.");
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || "Could not load admin dashboard analytics."
          );
        }

        setAdminAnalytics({
          totals: data.totals || {},
          breakdowns: data.breakdowns || {},
          recentActivity: data.recentActivity || {},
        });
      } catch (err) {
        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }
        setAdminAnalyticsError(
          err.message || "Could not load admin dashboard analytics."
        );
      } finally {
        if (sessionEpoch === matchSessionEpochRef.current) {
          setAdminAnalyticsLoading(false);
        }
      }
    },
    [auth?.token]
  );

  async function handleToggleLeaderboardOptOut(nextOptOut) {
    if (!auth?.token) return;

    setUpdatingOptOut(true);
    setRewardsError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/api/rewards/preferences`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ leaderboardOptOut: Boolean(nextOptOut) }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not update leaderboard visibility."
        );
      }

      setNotice(data.message || "Leaderboard preference updated.");
      await Promise.all([
        fetchMyRewards(auth.token),
        fetchLeaderboard(leaderboardPage),
      ]);
    } catch (err) {
      setRewardsError(
        err.message || "Could not update leaderboard visibility."
      );
    } finally {
      setUpdatingOptOut(false);
    }
  }

  function resetMatchCache({ closePanels = false } = {}) {
    matchSessionEpochRef.current += 1;
    matchInFlightRef.current = {};
    setMatchesByItem({});
    if (closePanels) {
      setOpenMatchItemIds({});
    }
  }

  async function handleFindMatches(itemId, { forceRefresh = false } = {}) {
    if (!auth?.token || !itemId) return;

    setOpenMatchItemIds((prev) => ({ ...prev, [itemId]: true }));

    if (matchInFlightRef.current[itemId]) {
      return;
    }

    const currentState = matchesByItem[itemId];
    if (currentState?.loading) {
      return;
    }
    if (currentState?.fetched && !currentState?.error && !forceRefresh) {
      return;
    }

    const sessionEpoch = matchSessionEpochRef.current;
    const requestId = (matchRequestIdRef.current[itemId] || 0) + 1;
    matchRequestIdRef.current[itemId] = requestId;
    matchInFlightRef.current[itemId] = true;

    setMatchesByItem((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {
          matches: [],
          disclaimer: "",
          candidateType: "",
        }),
        loading: true,
        error: "",
      },
    }));

    try {
      const response = await fetch(`${API_URL}/api/items/${itemId}/matches`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      });

      const data = await response.json().catch(() => null);

      if (
        matchSessionEpochRef.current !== sessionEpoch ||
        matchRequestIdRef.current[itemId] !== requestId
      ) {
        return;
      }

      if (response.status === 401) {
        throw new Error(
          "Your session has expired or is unauthorized. Please sign in again."
        );
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not load possible matches for this report."
        );
      }

      setMatchesByItem((prev) => ({
        ...prev,
        [itemId]: {
          loading: false,
          error: "",
          matches: Array.isArray(data.matches) ? data.matches : [],
          disclaimer:
            data.disclaimer ||
            "Match scores are heuristic suggestions based on report similarity and do not prove ownership.",
          candidateType: data.candidateType || "",
          fetched: true,
        },
      }));
    } catch (err) {
      if (
        matchSessionEpochRef.current !== sessionEpoch ||
        matchRequestIdRef.current[itemId] !== requestId
      ) {
        return;
      }

      setMatchesByItem((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] || {
            matches: [],
            disclaimer: "",
            candidateType: "",
          }),
          loading: false,
          error:
            err.message || "Could not load possible matches for this report.",
          fetched: false,
        },
      }));
    } finally {
      if (
        matchSessionEpochRef.current === sessionEpoch &&
        matchRequestIdRef.current[itemId] === requestId
      ) {
        delete matchInFlightRef.current[itemId];
      }
    }
  }

  function handleToggleMatches(item) {
    if (!item?._id) return;
    if (openMatchItemIds[item._id]) {
      setOpenMatchItemIds((prev) => ({ ...prev, [item._id]: false }));
      return;
    }
    handleFindMatches(item._id);
  }

  function handleViewCandidateReport(candidateItem) {
    if (!candidateItem?.title) return;
    setShowMyReports(false);
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setFilterType("");
    setFilterCategory("");
    setFilterStatus("");
    setLocationInput("");
    setDebouncedLocation("");
    setDateFrom("");
    setDateTo("");
    setSearchInput(candidateItem.title);
    setDebouncedSearch(candidateItem.title);
    setPage(1);
    const reportsEl = document.getElementById("reports");
    if (reportsEl && typeof reportsEl.scrollIntoView === "function") {
      reportsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const fetchAdminItems = useCallback(
    async (statusFilter = adminStatusFilter, showMod = includeModerated) => {
      if (!auth?.token) {
        setAdminUnauthorized(true);
        setAdminError("Authentication required.");
        return;
      }

      const sessionEpoch = matchSessionEpochRef.current;
      setAdminLoading(true);
      setAdminError("");
      setAdminUnauthorized(false);

      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        params.set("includeModerated", showMod ? "true" : "false");

        const response = await fetch(
          `${API_URL}/api/admin/items?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${auth.token}`,
            },
          }
        );

        const data = await response.json().catch(() => null);

        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setAdminUnauthorized(true);
          throw new Error(data?.message || "Admin access required.");
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || "Could not load reports for moderation."
          );
        }

        setAdminItems(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if (sessionEpoch !== matchSessionEpochRef.current) {
          return;
        }
        setAdminError(
          err.message || "Could not load reports for moderation."
        );
      } finally {
        if (sessionEpoch === matchSessionEpochRef.current) {
          setAdminLoading(false);
        }
      }
    },
    [auth?.token, adminStatusFilter, includeModerated]
  );

  async function openAdminDashboard() {
    setError("");
    setNotice("");
    setShowMyReports(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setShowAdminPanel(true);
    await Promise.all([
      fetchAdminItems(adminStatusFilter, includeModerated),
      fetchAdminAnalytics(),
    ]);
  }

  async function handleAdminStatusChange(itemId, newStatus) {
    if (!auth?.token) return;

    setModeratingId(itemId);
    setAdminError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/items/${itemId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        }
      );

      const data = await response.json().catch(() => null);

      if (response.status === 401 || response.status === 403) {
        setAdminUnauthorized(true);
        throw new Error(data?.message || "Admin access required.");
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || "Could not update report status."
        );
      }

      setMatchesByItem({});
      setNotice(data.message || "Report status updated.");
      await Promise.all([
        fetchAdminItems(adminStatusFilter, includeModerated),
        fetchAdminAnalytics(),
        loadItems(),
      ]);
    } catch (err) {
      setAdminError(err.message || "Could not update report status.");
    } finally {
      setModeratingId("");
    }
  }

  async function handleAdminModerateRemove(item) {
    if (!auth?.token) return;

    const reason = window.prompt(
      `Remove "${item.title}" from public listing?\nEnter moderation reason (optional, max 300 chars):`,
      "Inappropriate or duplicate report"
    );

    if (reason === null) return;

    setModeratingId(item._id);
    setAdminError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/items/${item._id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );

      const data = await response.json().catch(() => null);

      if (response.status === 401 || response.status === 403) {
        setAdminUnauthorized(true);
        throw new Error(data?.message || "Admin access required.");
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not moderate report.");
      }

      setMatchesByItem({});
      setOpenMatchItemIds((prev) => {
        const next = { ...prev };
        delete next[item._id];
        return next;
      });
      setNotice(data.message || "Report moderated and removed.");
      await Promise.all([
        fetchAdminItems(adminStatusFilter, includeModerated),
        fetchAdminAnalytics(),
        loadItems(),
        auth?.token ? fetchNotifications(auth.token) : Promise.resolve(),
      ]);
    } catch (err) {
      setAdminError(err.message || "Could not moderate report.");
    } finally {
      setModeratingId("");
    }
  }

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    fetchLeaderboard(1);
  }, [fetchLeaderboard]);

  async function handleAuthenticated(session) {
    resetMatchCache({ closePanels: true });
    setAuth(session);
    setError("");
    setNotice("");
    setShowAdminPanel(false);
    setShowMyReports(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setForm(createEmptyForm());

    // Verify canonical user profile and role from /api/auth/me
    if (session?.token) {
      const sessionEpoch = matchSessionEpochRef.current;
      fetchMyRewards(session.token);
      fetchNotifications(session.token, false);
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
        });
        const data = await response.json().catch(() => null);
        if (
          sessionEpoch === matchSessionEpochRef.current &&
          response.ok &&
          data?.success &&
          data.user
        ) {
          setAuth({
            token: session.token,
            user: data.user,
          });
        }
      } catch {
        // Retain initial session from login/register if profile refresh fails
      }
    }
  }

  function handleLogout() {
    resetMatchCache({ closePanels: true });
    setAuth(null);
    setMyItems([]);
    setAdminItems([]);
    setAdminAnalytics(null);
    setAdminAnalyticsError("");
    setMyClaims([]);
    setReceivedClaims([]);
    setRewardProfile(null);
    setRewardHistory([]);
    setRewardsError("");
    setNotifications([]);
    setUnreadNotificationCount(0);
    setNotificationsError("");
    setShowMyReports(false);
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setMobileNavOpen(false);
    setExpandedItemIds({});
    setEditingItemId("");
    setClaimingItemId("");
    setClaimProofText("");
    setClaimsError("");
    setAdminError("");
    setAdminUnauthorized(false);
    setError("");
    setNotice("");
    setForm(createEmptyForm());
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!auth?.token) {
      setError("Please sign in before submitting a report.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not submit report.");
      }

      const xpBonus =
        data.reward?.awarded && data.reward?.pointsAwarded > 0
          ? ` (+${data.reward.pointsAwarded} XP earned!)`
          : "";
      setNotice(`Report submitted successfully!${xpBonus}`);
      setForm(createEmptyForm());
      setMatchesByItem({});

      await loadItems();
      if (auth?.token) {
        await fetchMyRewards(auth.token);
      }
      if (showRewardsPanel) {
        await fetchLeaderboard(leaderboardPage);
      }
      if (showAdminPanel && auth?.user?.role === "admin") {
        await fetchAdminAnalytics(auth.token);
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(item) {
  const title = window.prompt("Item name:", item.title);
  if (title === null) return;

  const description = window.prompt(
    "Description:",
    item.description
  );
  if (description === null) return;

  const location = window.prompt(
    "Campus location:",
    item.location
  );
  if (location === null) return;

  if (!title.trim() || !description.trim() || !location.trim()) {
    setError("These fields cannot be empty.");
    return;
  }

  setError("");
  setNotice("");

  try {
    const response = await fetch(
      `${API_URL}/api/items/${item._id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          location: location.trim(),
        }),
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || "Could not update report.");
    }

    setMatchesByItem({});
    await loadItems();
    await fetchMyItems();

    setShowMyReports(true);
    setNotice("Report updated successfully.");
  } catch (err) {
    setError(err.message || "Could not update report.");
  }
}

async function handleDelete(itemId) {
  const confirmed = window.confirm(
    "Are you sure you want to delete this report?"
  );

  if (!confirmed) return;

  setError("");
  setNotice("");

  try {
    const response = await fetch(
      `${API_URL}/api/items/${itemId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || "Could not delete report.");
    }

    setMatchesByItem({});
    setOpenMatchItemIds((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    await loadItems();
    await fetchMyItems();
    if (auth?.token) {
      await fetchMyRewards(auth.token);
    }
    if (showRewardsPanel) {
      await fetchLeaderboard(leaderboardPage);
    }
    if (showAdminPanel && auth?.user?.role === "admin") {
      await fetchAdminAnalytics(auth.token);
    }

    setShowMyReports(true);
    setNotice("Report deleted successfully.");
  } catch (err) {
    setError(err.message || "Could not delete report.");
  }
}

  function handleStartEdit(item) {
    setError("");
    setNotice("");
    setEditingItemId(item._id);
    const formattedDate = item.itemDate
      ? new Date(item.itemDate).toISOString().slice(0, 10)
      : getToday();
    setEditForm({
      title: item.title || "",
      description: item.description || "",
      category: item.category || "Electronics",
      type: item.type || "LOST",
      location: item.location || "",
      itemDate: formattedDate,
    });
  }

  function handleEditFormChange(event) {
    const { name, value } = event.target;
    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handleCancelEdit() {
    setEditingItemId("");
    setError("");
  }

  async function handleSaveEdit(event, itemId) {
    event.preventDefault();
    if (!auth?.token || !itemId) return;

    const trimmedTitle = editForm.title.trim();
    const trimmedDescription = editForm.description.trim();
    const trimmedLocation = editForm.location.trim();

    if (!trimmedTitle || !trimmedDescription || !trimmedLocation) {
      setError("Title, description, and campus location cannot be empty.");
      return;
    }

    setEditSubmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/api/items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          title: trimmedTitle,
          description: trimmedDescription,
          category: editForm.category,
          type: editForm.type,
          location: trimmedLocation,
          itemDate: editForm.itemDate,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not update report.");
      }

      setEditingItemId("");
      setMatchesByItem({});
      await loadItems();
      if (showMyReports) {
        await fetchMyItems();
      }
      setNotice("Report updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update report.");
    } finally {
      setEditSubmitting(false);
    }
  }

  function toggleItemDetails(itemId) {
    setExpandedItemIds((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  }

  function getUserInitials(name) {
    if (!name || typeof name !== "string") return "U";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function getCategoryIcon(category, title = "") {
    const lowerTitle = typeof title === "string" ? title.toLowerCase() : "";

    if (lowerTitle.includes("wallet") || lowerTitle.includes("purse")) {
      return (
        <svg
          viewBox="0 0 36 36"
          className="line-icon-svg"
          aria-hidden="true"
        >
          <rect x="5" y="9" width="24" height="18" rx="3.5" />
          <path d="M23 15h7a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 30 21h-7a3 3 0 0 1 0-6Z" />
          <circle cx="25.5" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    }

    if (lowerTitle.includes("bottle") || lowerTitle.includes("flask")) {
      return (
        <svg
          viewBox="0 0 36 36"
          className="line-icon-svg"
          aria-hidden="true"
        >
          <path d="M15 6h6v3h-6z" />
          <path d="M14 9h8l1.5 5v14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V14L14 9Z" />
          <line x1="13" y1="14" x2="23" y2="14" />
        </svg>
      );
    }

    switch (category) {
      case "Keys":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <circle cx="13" cy="18" r="5" />
            <path d="M18 18h12M26 18v4M29 18v3" />
          </svg>
        );
      case "Bags":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <path d="M14 9V7a4 4 0 0 1 8 0v2" />
            <rect x="9" y="9" width="18" height="20" rx="5" />
            <line x1="13" y1="20" x2="23" y2="20" />
          </svg>
        );
      case "Electronics":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <rect x="11" y="6" width="14" height="24" rx="3" />
            <line x1="16" y1="26" x2="20" y2="26" />
          </svg>
        );
      case "Documents":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <rect x="6" y="10" width="24" height="16" rx="2.5" />
            <circle cx="12.5" cy="18" r="2.5" />
            <line x1="18" y1="16" x2="26" y2="16" />
            <line x1="18" y1="20" x2="24" y2="20" />
          </svg>
        );
      case "Books":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <path d="M8 8h16a3 3 0 0 1 3 3v17H11a3 3 0 0 1-3-3V8Z" />
            <path d="M8 25a3 3 0 0 1 3-3h16" />
          </svg>
        );
      case "Clothing":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <path d="M13 8l-6 5 3 4 3-2v13h10V15l3 2 3-4-6-5a4 4 0 0 1-10 0Z" />
          </svg>
        );
      case "Accessories":
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <rect x="5" y="9" width="24" height="18" rx="3.5" />
            <path d="M23 15h7a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 30 21h-7a3 3 0 0 1 0-6Z" />
            <circle cx="25.5" cy="18" r="1" fill="currentColor" stroke="none" />
          </svg>
        );
      default:
        return (
          <svg
            viewBox="0 0 36 36"
            className="line-icon-svg"
            aria-hidden="true"
          >
            <path d="M8 18l10-10h10v10L18 28 8 18Z" />
            <circle cx="23" cy="13" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        );
    }
  }

  function formatRelativeItemDate(dateStr) {
    if (!dateStr) return "Recently";
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return "Recently";

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfItemDay = new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate()
    );
    const diffDays = Math.round(
      (startOfToday - startOfItemDay) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays <= 14) return `${diffDays} days ago`;

    return parsed.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function handleHeroReportAction(selectedType) {
    setForm((prev) => ({
      ...prev,
      type: selectedType,
    }));
    setShowMyReports(false);
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    setMobileNavOpen(false);

    const targetId = auth ? "report-form" : "account";
    const targetEl = document.getElementById(targetId);
    if (targetEl && typeof targetEl.scrollIntoView === "function") {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleHeroSearchSubmit(event) {
    event.preventDefault();
    setDebouncedSearch(searchInput.trim());
    setPage(1);
    setShowMyReports(false);
    setShowAdminPanel(false);
    setShowClaimsPanel(false);
    setShowRewardsPanel(false);
    setShowNotificationsPanel(false);
    const reportsEl = document.getElementById("reports");
    if (reportsEl && typeof reportsEl.scrollIntoView === "function") {
      reportsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleCategoryChipClick(categoryValue) {
    const nextCategory =
      filterCategory === categoryValue ? "" : categoryValue;
    setFilterCategory(nextCategory);
    setPage(1);
    setShowMyReports(false);
    const reportsEl = document.getElementById("reports");
    if (reportsEl && typeof reportsEl.scrollIntoView === "function") {
      reportsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleInspectRecentItem(item) {
    if (!item?._id) return;
    setShowMyReports(false);
    setExpandedItemIds((prev) => ({
      ...prev,
      [item._id]: true,
    }));
    const cardEl =
      document.getElementById(`item-card-${item._id}`) ||
      document.getElementById("reports");
    if (cardEl && typeof cardEl.scrollIntoView === "function") {
      cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const totalCount =
    publicStats?.total ?? pagination.totalItems ?? items.length;
  const lostCount =
    publicStats?.lost ??
    items.filter((item) => item.type === "LOST").length;
  const foundCount =
    publicStats?.found ??
    items.filter((item) => item.type === "FOUND").length;

  const displayedItems = showMyReports ? myItems : items;
  const recentPreviewItems = items.slice(0, 4);

  // Derive a real fetched match for the "See why items match" preview card if available
  let bestLiveMatch = null;
  for (const [sourceId, state] of Object.entries(matchesByItem)) {
    if (state?.fetched && Array.isArray(state.matches) && state.matches.length > 0) {
      const topCandidate = state.matches[0];
      const sourceItem =
        items.find((it) => it._id === sourceId) ||
        myItems.find((it) => it._id === sourceId);
      if (
        !bestLiveMatch ||
        (topCandidate.matchScore || 0) > (bestLiveMatch.score || 0)
      ) {
        bestLiveMatch = {
          sourceTitle: sourceItem?.title || topCandidate.item?.title || "Report",
          candidateTitle: topCandidate.item?.title || "Candidate report",
          score:
            typeof topCandidate.matchScore === "number"
              ? topCandidate.matchScore
              : 0,
          reasons: Array.isArray(topCandidate.reasons)
            ? topCandidate.reasons
            : [],
          candidate: topCandidate.item,
        };
      }
    }
  }

  return (
    <div className="site-wrapper">
      <header className="site-navbar">
        <div className="navbar-inner">
          <a
            className="site-logo"
            href="#home"
            onClick={() => {
              setShowMyReports(false);
              setShowRewardsPanel(false);
              setShowClaimsPanel(false);
              setShowNotificationsPanel(false);
              setShowAdminPanel(false);
              setMobileNavOpen(false);
            }}
          >
            LostLink
          </a>

          <nav
            className={`navbar-links ${mobileNavOpen ? "open" : ""}`}
            aria-label="Main navigation"
          >
            <a
              className="navbar-link"
              href="#reports"
              onClick={() => {
                setShowMyReports(false);
                setMobileNavOpen(false);
              }}
            >
              Browse
            </a>

            <button
              type="button"
              className={`navbar-link-btn ${showRewardsPanel ? "active" : ""}`}
              onClick={() => {
                setMobileNavOpen(false);
                if (showRewardsPanel) {
                  setShowRewardsPanel(false);
                } else {
                  openRewardsPanel();
                }
              }}
            >
              Leaderboard
            </button>

            {auth && (
              <>
                <button
                  type="button"
                  className={`navbar-link-btn ${showMyReports ? "active" : ""}`}
                  onClick={() => {
                    setMobileNavOpen(false);
                    loadMyReports();
                  }}
                >
                  My Reports
                  {myItems.length > 0 && (
                    <span className="nav-count-chip">{myItems.length}</span>
                  )}
                </button>

                <button
                  type="button"
                  className={`navbar-link-btn ${showClaimsPanel ? "active" : ""}`}
                  onClick={() => {
                    setMobileNavOpen(false);
                    if (showClaimsPanel) {
                      setShowClaimsPanel(false);
                    } else {
                      openClaimsPanel();
                    }
                  }}
                >
                  Claims
                </button>

                {auth.user.role === "admin" && (
                  <button
                    type="button"
                    className={`navbar-link-btn admin-link-btn ${
                      showAdminPanel ? "active" : ""
                    }`}
                    onClick={() => {
                      setMobileNavOpen(false);
                      if (showAdminPanel) {
                        setShowAdminPanel(false);
                      } else {
                        openAdminDashboard();
                      }
                    }}
                  >
                    Admin
                  </button>
                )}
              </>
            )}
          </nav>

          <div className="navbar-right-controls">
            <button
              type="button"
              className={`notif-bell-button ${
                showNotificationsPanel ? "active" : ""
              }`}
              aria-label={
                unreadNotificationCount > 0
                  ? `Notifications (${unreadNotificationCount} unread)`
                  : "Notifications"
              }
              onClick={() => {
                setMobileNavOpen(false);
                if (!auth) {
                  setNotice("Sign in to view your activity notifications.");
                  const accEl = document.getElementById("account");
                  if (accEl && typeof accEl.scrollIntoView === "function") {
                    accEl.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                  return;
                }
                if (showNotificationsPanel) {
                  setShowNotificationsPanel(false);
                } else {
                  openNotificationsPanel();
                }
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="bell-svg"
                aria-hidden="true"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {auth && unreadNotificationCount > 0 && (
                <span className="notif-bell-badge">
                  {unreadNotificationCount}
                </span>
              )}
            </button>

            {auth ? (
              <div className="navbar-user-group">
                <div className="navbar-user-pill">
                  <span className="navbar-avatar" aria-hidden="true">
                    {getUserInitials(auth.user.name)}
                  </span>
                  <span className="navbar-user-name">{auth.user.name}</span>
                  {rewardProfile && (
                    <span className="navbar-xp-tag">
                      Lvl {rewardProfile.level} · {rewardProfile.xp} XP
                    </span>
                  )}
                  {auth.user.role === "admin" && (
                    <span className="role-badge">ADMIN</span>
                  )}
                </div>

                <button
                  type="button"
                  className="signout-button"
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <a className="signin-cta-button" href="#account">
                Sign in
              </a>
            )}

            <button
              type="button"
              className="mobile-menu-trigger"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((prev) => !prev)}
            >
              {mobileNavOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>
      </header>

      <main id="home">
        {/* Reference Hero Section */}
        <section className="hero-banner">
          <div className="hero-banner-inner">
            <h1>
              Lost something on campus?
              <br />
              Let&apos;s find it.
            </h1>

            <p className="hero-subtitle">
              Post what you lost or found, and LostLink matches it with listings
              from across campus.
            </p>

            <div className="hero-cta-row">
              <button
                type="button"
                className="hero-cta-btn hero-cta-lost"
                onClick={() => handleHeroReportAction("LOST")}
              >
                I lost something
              </button>

              <button
                type="button"
                className="hero-cta-btn hero-cta-found"
                onClick={() => handleHeroReportAction("FOUND")}
              >
                I found something
              </button>
            </div>

            <form
              className="hero-search-bar"
              role="search"
              onSubmit={handleHeroSearchSubmit}
            >
              <span className="hero-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="search-svg">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.2" y2="16.2" />
                </svg>
              </span>

              <input
                type="search"
                className="hero-search-input"
                aria-label="Search campus lost and found items"
                placeholder="Search keys, wallet, ID card..."
                value={searchInput}
                maxLength={100}
                onChange={(e) => setSearchInput(e.target.value)}
              />

              <button type="submit" className="hero-search-submit">
                Search
              </button>
            </form>

            <div
              className="hero-category-chips"
              role="group"
              aria-label="Filter items by category"
            >
              <button
                type="button"
                className={`category-chip ${
                  !showMyReports && filterCategory === "" ? "active" : ""
                }`}
                onClick={() => handleCategoryChipClick("")}
              >
                All ({totalCount})
              </button>

              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`category-chip ${
                    !showMyReports && filterCategory === cat ? "active" : ""
                  }`}
                  onClick={() => handleCategoryChipClick(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="container">
          {/* Reference "Recently posted" 4-Card Section */}
          <section
            className="recently-posted-section"
            aria-label="Recently posted campus items"
          >
            <div className="section-row-header">
              <h2>Recently posted</h2>
              <a
                className="see-all-link"
                href="#reports"
                onClick={() => {
                  setShowMyReports(false);
                }}
              >
                See all items
              </a>
            </div>

            {loading ? (
              <div
                className="recent-cards-grid"
                role="status"
                aria-label="Loading recently posted items"
              >
                {[1, 2, 3, 4].map((sk) => (
                  <div className="recent-item-card skeleton-recent-card" key={sk}>
                    <div className="recent-card-illustration skeleton-shimmer" />
                    <div className="recent-card-body">
                      <div className="skeleton-line short" />
                      <div className="skeleton-line title" />
                      <div className="skeleton-line medium" />
                      <div className="skeleton-line meta" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentPreviewItems.length === 0 ? (
              <div className="empty-state">
                <h3>No items posted yet</h3>
                <p>
                  {hasActiveFilters
                    ? "No items match your active search or category filter."
                    : "Post a lost or found item above to populate the campus directory."}
                </p>
                {hasActiveFilters && (
                  <button type="button" onClick={handleClearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="recent-cards-grid">
                {recentPreviewItems.map((item) => {
                  const isFound = item.type === "FOUND";
                  return (
                    <article className="recent-item-card" key={`recent-${item._id}`}>
                      <div
                        className="recent-card-illustration"
                        aria-hidden="true"
                      >
                        {getCategoryIcon(item.category, item.title)}
                      </div>

                      <div className="recent-card-body">
                        <div className="recent-card-badges">
                          <span
                            className={`compact-type-pill ${
                              isFound ? "found" : "lost"
                            }`}
                          >
                            {isFound ? "Found" : "Lost"}
                          </span>

                          {item.status && item.status !== "OPEN" && (
                            <span
                              className={`item-status status-${item.status.toLowerCase()}`}
                            >
                              {item.status.replace("_", " ")}
                            </span>
                          )}
                        </div>

                        <h3 className="recent-card-title">{item.title}</h3>

                        <p className="recent-card-location">
                          <svg
                            viewBox="0 0 24 24"
                            className="pin-svg"
                            aria-hidden="true"
                          >
                            <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" />
                            <circle cx="12" cy="11" r="2" />
                          </svg>
                          <span>{item.location}</span>
                        </p>

                        <span className="recent-card-date">
                          {formatRelativeItemDate(
                            item.itemDate || item.createdAt
                          )}
                        </span>

                        <button
                          type="button"
                          className="recent-view-details-link"
                          onClick={() => handleInspectRecentItem(item)}
                        >
                          View details
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Reference 3-Step "How it works" Section */}
          <section
            className="how-it-works-section"
            aria-label="How LostLink works"
          >
            <h2>How it works</h2>

            <div className="how-steps-grid">
              <div className="how-step-card">
                <span className="how-step-number" aria-hidden="true">
                  1
                </span>
                <h3>Post it</h3>
                <p>
                  Share what you lost or found in under a minute, with the
                  campus location and date.
                </p>
              </div>

              <div className="how-step-card">
                <span className="how-step-number" aria-hidden="true">
                  2
                </span>
                <h3>Get matched</h3>
                <p>
                  Smart matching compares category, place, time and details, and
                  shows why it thinks they match.
                </p>
              </div>

              <div className="how-step-card">
                <span className="how-step-number" aria-hidden="true">
                  3
                </span>
                <h3>Verify and return</h3>
                <p>
                  Submit private ownership proof to claim, get verified safely
                  in-app, then hand over on campus.
                </p>
              </div>
            </div>
          </section>

          {/* Reference Two-Column Feature Showcase: Explainable Matching & Campus Heroes */}
          <section
            className="feature-showcase-section"
            aria-label="Smart matching and campus leaderboard highlights"
          >
            <article className="feature-panel matching-feature-panel">
              <span className="feature-pill aqua-pill">
                Explainable matching
              </span>
              <h2>See why items match</h2>
              <p className="feature-panel-sub">
                Every suggestion shows its reasons, so you can trust it at a
                glance.
              </p>

              <div className="match-preview-widget">
                {bestLiveMatch ? (
                  <>
                    <div className="match-widget-top">
                      <strong>{bestLiveMatch.candidateTitle}</strong>
                      <span className="match-widget-score">
                        {bestLiveMatch.score}% match
                      </span>
                    </div>

                    <div className="match-widget-bar" aria-hidden="true">
                      <div
                        className="match-widget-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, bestLiveMatch.score))}%`,
                        }}
                      />
                    </div>

                    <div className="match-widget-reasons">
                      {bestLiveMatch.reasons.length > 0 ? (
                        bestLiveMatch.reasons.map((reason, idx) => (
                          <span
                            className="match-reason-pill"
                            key={`preview-reason-${idx}`}
                          >
                            {reason}
                          </span>
                        ))
                      ) : (
                        <span className="match-reason-pill">
                          Matched with {bestLiveMatch.sourceTitle}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="match-widget-top">
                      <strong>
                        {items[0]?.title
                          ? `Latest listing: ${items[0].title}`
                          : "Rule-based similarity engine"}
                      </strong>
                      <span className="match-widget-score">
                        {lostCount} lost · {foundCount} found
                      </span>
                    </div>

                    <div className="match-widget-bar" aria-hidden="true">
                      <div
                        className="match-widget-bar-fill"
                        style={{
                          width:
                            totalCount > 0
                              ? `${Math.min(100, Math.max(25, Math.round((foundCount / totalCount) * 100)))}%`
                              : "0%",
                        }}
                      />
                    </div>

                    <div className="match-widget-reasons">
                      <span className="match-reason-pill">Same category</span>
                      <span className="match-reason-pill">
                        Campus location proximity
                      </span>
                      <span className="match-reason-pill">
                        Keyword &amp; date alignment
                      </span>
                    </div>

                    {auth && items[0]?._id && (
                      <div style={{ marginTop: "12px" }}>
                        <button
                          type="button"
                          className="recent-view-details-link"
                          onClick={() => {
                            handleFindMatches(items[0]._id);
                            handleInspectRecentItem(items[0]);
                          }}
                        >
                          Check live matches for &ldquo;{items[0].title}&rdquo; →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>

            <article
              className="feature-panel heroes-feature-panel"
              id="campus-heroes"
            >
              <span className="feature-pill amber-pill">Campus Heroes</span>
              <h2>Earn XP for helping others</h2>
              <p className="feature-panel-sub">
                Return items, earn badges and climb the leaderboard.
              </p>

              {leaderboardLoading && leaderboard.length === 0 ? (
                <p className="heroes-empty-note" role="status">
                  Loading campus leaderboard...
                </p>
              ) : leaderboard.length === 0 ? (
                <div className="heroes-empty-note">
                  <p>
                    No verified XP rankings yet. Report lost or found items and
                    complete verified returns to become the #1 Campus Hero!
                  </p>
                </div>
              ) : (
                <ul className="heroes-preview-list">
                  {leaderboard.slice(0, 3).map((entry) => (
                    <li className="heroes-preview-row" key={entry.userId}>
                      <div className="heroes-preview-left">
                        <span className="heroes-rank-circle">
                          {entry.rank}
                        </span>
                        <strong>{entry.displayName}</strong>
                      </div>
                      <span className="heroes-preview-metric">
                        {entry.xp} XP · Lvl {entry.level}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="heroes-panel-footer">
                <button
                  type="button"
                  className="heroes-open-btn"
                  onClick={() => {
                    openRewardsPanel();
                    const el = document.getElementById("rewards-panel");
                    if (el && typeof el.scrollIntoView === "function") {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  {auth
                    ? "Open my XP, badges & full leaderboard →"
                    : "View full campus leaderboard →"}
                </button>
              </div>
            </article>
          </section>

          {!auth && (
            <section id="account">
              <AuthPanel onAuthenticated={handleAuthenticated} />
            </section>
          )}

        {showRewardsPanel && (
          <section className="rewards-section" id="rewards-panel">
            <div className="reports-heading">
              <div>
                <span className="eyebrow">COMMUNITY RECOGNITION</span>
                <h2>XP, Badges & Campus Leaderboard</h2>
              </div>

              <div className="admin-controls">
                <button
                  className="refresh-button"
                  type="button"
                  disabled={rewardsLoading || leaderboardLoading}
                  onClick={() => {
                    if (auth?.token) {
                      fetchMyRewards(auth.token);
                    }
                    fetchLeaderboard(leaderboardPage);
                  }}
                >
                  {rewardsLoading || leaderboardLoading
                    ? "Loading..."
                    : "↻ Refresh"}
                </button>
              </div>
            </div>

            {notice && (
              <p className="message success-message" role="status">
                {notice}
              </p>
            )}

            <div className="rewards-grid">
              {/* Left Column: Authenticated User XP, Level & Badges */}
              <div className="rewards-column">
                <h3 className="claims-subheading">
                  My XP, Level & Badges
                </h3>

                {!auth ? (
                  <div className="empty-state">
                    <h3>Sign in to earn XP and badges</h3>
                    <p>
                      Submit verified lost or found reports (+10 / +15 XP) and
                      help complete verified item returns (+50 XP to finder, +15
                      XP to verified owner) to level up and unlock campus
                      badges.
                    </p>
                    <a className="primary-link" href="#account">
                      Continue with Google
                    </a>
                  </div>
                ) : rewardsLoading && !rewardProfile ? (
                  <p className="empty-state" role="status">
                    Loading your XP and badge profile...
                  </p>
                ) : rewardsError ? (
                  <div className="empty-state" role="alert">
                    <h3>Unable to load reward profile</h3>
                    <p>{rewardsError}</p>
                    <button
                      type="button"
                      onClick={() => fetchMyRewards(auth.token)}
                    >
                      Retry
                    </button>
                  </div>
                ) : rewardProfile ? (
                  <div className="reward-profile-box">
                    <div className="xp-summary-card">
                      <div className="xp-summary-top">
                        <div>
                          <span className="xp-level-badge">
                            LEVEL {rewardProfile.level}
                          </span>
                          <h4 className="xp-total-heading">
                            {rewardProfile.xp} Total XP
                          </h4>
                        </div>
                        <span className="xp-next-label">
                          {rewardProfile.progress?.xpNeededForNextLevel ?? 100}{" "}
                          XP to Level {(rewardProfile.level || 1) + 1}
                        </span>
                      </div>

                      <div
                        className="xp-progress-track"
                        role="progressbar"
                        aria-label="Progress to next level"
                        aria-valuenow={
                          rewardProfile.progress?.progressPercent ?? 0
                        }
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="xp-progress-fill"
                          style={{
                            width: `${
                              rewardProfile.progress?.progressPercent ?? 0
                            }%`,
                          }}
                        />
                      </div>

                      <div className="xp-progress-meta">
                        <span>
                          {rewardProfile.progress?.xpIntoLevel ?? 0} /{" "}
                          {rewardProfile.progress?.xpPerLevel ?? 100} XP in
                          Level {rewardProfile.level}
                        </span>
                        <span>
                          {rewardProfile.progress?.progressPercent ?? 0}%
                        </span>
                      </div>
                    </div>

                    <div className="badges-showcase">
                      <div className="badges-header-row">
                        <h4 className="rewards-minor-heading">
                          Badges Earned (
                          {rewardProfile.earnedBadges?.length || 0} /{" "}
                          {rewardProfile.badgeCatalog?.length || 4})
                        </h4>
                      </div>

                      {(rewardProfile.earnedBadges?.length || 0) === 0 && (
                        <p className="rewards-empty-note">
                          No badges unlocked yet. Report a lost or found item or
                          complete a verified handover to earn your first badge!
                        </p>
                      )}

                      <div className="badge-catalog-grid">
                        {(rewardProfile.badgeCatalog || []).map((badge) => (
                          <div
                            key={badge.code}
                            className={`badge-item-card ${
                              badge.earned ? "earned" : "locked"
                            }`}
                          >
                            <div className="badge-icon-circle" aria-hidden="true">
                              {badge.icon || "★"}
                            </div>
                            <div className="badge-item-info">
                              <div className="badge-title-row">
                                <strong>{badge.name}</strong>
                                <span
                                  className={`badge-state-pill ${
                                    badge.earned ? "earned" : "locked"
                                  }`}
                                >
                                  {badge.earned ? "UNLOCKED" : "LOCKED"}
                                </span>
                              </div>
                              <p>{badge.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="reward-history-box">
                      <h4 className="rewards-minor-heading">
                        Recent Verified XP Activity
                      </h4>
                      {rewardHistory.length === 0 ? (
                        <p className="rewards-empty-note">
                          No verified XP events yet.
                        </p>
                      ) : (
                        <ul className="reward-history-list">
                          {rewardHistory.slice(0, 6).map((ev) => (
                            <li key={ev._id} className="reward-history-item">
                              <span className="reward-history-reason">
                                {ev.reason}
                              </span>
                              <span className="reward-history-points">
                                +{ev.points} XP
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="leaderboard-optout-row">
                      <label className="admin-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(rewardProfile.leaderboardOptOut)}
                          disabled={updatingOptOut}
                          onChange={(e) =>
                            handleToggleLeaderboardOptOut(e.target.checked)
                          }
                        />
                        Hide my profile from the public campus leaderboard
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Right Column: Public Campus Leaderboard */}
              <div className="rewards-column">
                <h3 className="claims-subheading">
                  Campus Community Leaderboard
                </h3>

                {leaderboardLoading ? (
                  <p className="empty-state" role="status">
                    Loading campus leaderboard...
                  </p>
                ) : leaderboardError ? (
                  <div className="empty-state" role="alert">
                    <h3>Unable to load leaderboard</h3>
                    <p>{leaderboardError}</p>
                    <button
                      type="button"
                      onClick={() => fetchLeaderboard(leaderboardPage)}
                    >
                      Retry
                    </button>
                  </div>
                ) : leaderboard.length === 0 ? (
                  <div className="empty-state">
                    <h3>No leaderboard entries yet</h3>
                    <p>
                      Community members who earn verified XP will appear here.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="leaderboard-list">
                      {leaderboard.map((entry) => {
                        const isCurrentUser =
                          auth?.user?.id &&
                          String(entry.userId) === String(auth.user.id);
                        const rankClass =
                          entry.rank === 1
                            ? "rank-1"
                            : entry.rank === 2
                              ? "rank-2"
                              : entry.rank === 3
                                ? "rank-3"
                                : "";

                        return (
                          <div
                            key={entry.userId}
                            className={`leaderboard-row ${
                              isCurrentUser ? "current-user-row" : ""
                            }`}
                          >
                            <div className="leaderboard-rank-and-name">
                              <span
                                className={`leaderboard-rank-badge ${rankClass}`}
                              >
                                #{entry.rank}
                              </span>
                              <div>
                                <div className="leaderboard-name-line">
                                  <strong>{entry.displayName}</strong>
                                  {isCurrentUser && (
                                    <span className="you-pill">YOU</span>
                                  )}
                                </div>
                                <div className="leaderboard-submeta">
                                  <span>Level {entry.level}</span>
                                  {entry.badgeCount > 0 && (
                                    <span>
                                      · {entry.badgeCount} badge
                                      {entry.badgeCount === 1 ? "" : "s"} (
                                      {(entry.badges || [])
                                        .map((b) => b.icon || "★")
                                        .join(" ")}
                                      )
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="leaderboard-xp-pill">
                              {entry.xp} XP
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {leaderboardPagination.totalPages > 1 && (
                      <nav
                        className="pagination-bar"
                        aria-label="Leaderboard pagination"
                        style={{ marginTop: "14px" }}
                      >
                        <button
                          type="button"
                          className="pagination-button"
                          disabled={
                            !leaderboardPagination.hasPrevPage ||
                            leaderboardLoading
                          }
                          onClick={() =>
                            fetchLeaderboard(Math.max(1, leaderboardPage - 1))
                          }
                        >
                          ← Previous
                        </button>

                        <span className="pagination-info">
                          Page {leaderboardPagination.currentPage} of{" "}
                          {leaderboardPagination.totalPages}
                        </span>

                        <button
                          type="button"
                          className="pagination-button"
                          disabled={
                            !leaderboardPagination.hasNextPage ||
                            leaderboardLoading
                          }
                          onClick={() => fetchLeaderboard(leaderboardPage + 1)}
                        >
                          Next →
                        </button>
                      </nav>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {auth && showNotificationsPanel && (
          <section className="notifications-section" id="notifications-panel">
            <div className="reports-heading">
              <div>
                <span className="eyebrow">ACTIVITY UPDATES</span>
                <h2>
                  Your Notifications
                  {unreadNotificationCount > 0
                    ? ` (${unreadNotificationCount} unread)`
                    : ""}
                </h2>
              </div>

              <div className="admin-controls">
                <label className="admin-checkbox-label">
                  <input
                    type="checkbox"
                    checked={notificationsUnreadOnly}
                    onChange={(e) => {
                      const nextUnread = e.target.checked;
                      setNotificationsUnreadOnly(nextUnread);
                      fetchNotifications(auth.token, nextUnread);
                    }}
                  />
                  Unread only
                </label>

                <button
                  type="button"
                  className="action-button edit-button"
                  disabled={unreadNotificationCount === 0 || markingAllRead}
                  onClick={handleMarkAllNotificationsRead}
                >
                  {markingAllRead ? "Marking..." : "Mark all as read"}
                </button>

                <button
                  className="refresh-button"
                  type="button"
                  disabled={notificationsLoading}
                  onClick={() =>
                    fetchNotifications(auth.token, notificationsUnreadOnly)
                  }
                >
                  {notificationsLoading ? "Loading..." : "↻ Refresh"}
                </button>
              </div>
            </div>

            {notificationsError && (
              <div className="matches-error-box" role="alert">
                <p>{notificationsError}</p>
                <button
                  type="button"
                  className="action-button edit-button"
                  onClick={() =>
                    fetchNotifications(auth.token, notificationsUnreadOnly)
                  }
                >
                  Retry
                </button>
              </div>
            )}

            {notice && (
              <p className="message success-message" role="status">
                {notice}
              </p>
            )}

            {notificationsLoading ? (
              <p className="empty-state" role="status">
                Loading notifications...
              </p>
            ) : notifications.length === 0 ? (
              <div className="empty-state">
                <h3>
                  {notificationsUnreadOnly
                    ? "No unread notifications"
                    : "No notifications yet"}
                </h3>
                <p>
                  {notificationsUnreadOnly
                    ? "You are all caught up! Switch off 'Unread only' to view earlier activity."
                    : "Updates when someone submits a claim on your found item or reviews your ownership claim will appear here."}
                </p>
              </div>
            ) : (
              <div className="notifications-list">
                {notifications.map((notif) => {
                  const typeClass =
                    notif.type === "CLAIM_APPROVED" ||
                    notif.type === "ITEM_RETURNED"
                      ? "approved"
                      : notif.type === "CLAIM_REJECTED" ||
                          notif.type === "REPORT_MODERATED"
                        ? "rejected"
                        : "pending";
                  const typeLabel =
                    notif.type === "CLAIM_SUBMITTED"
                      ? "NEW CLAIM"
                      : notif.type === "CLAIM_APPROVED"
                        ? "CLAIM APPROVED"
                        : notif.type === "CLAIM_REJECTED"
                          ? "CLAIM REJECTED"
                          : notif.type === "ITEM_RETURNED"
                            ? "ITEM RETURNED"
                            : notif.type === "REPORT_MODERATED"
                              ? "REPORT MODERATED"
                              : "UPDATE";

                  return (
                    <article
                      key={notif._id}
                      className={`notification-card ${
                        notif.read ? "read" : "unread"
                      }`}
                    >
                      <div className="notification-card-main">
                        <div className="notification-top-row">
                          <div className="badge-group">
                            <span
                              className={`claim-status-badge ${typeClass}`}
                            >
                              {typeLabel}
                            </span>
                            {!notif.read && (
                              <span className="notif-unread-pill">UNREAD</span>
                            )}
                          </div>
                          {notif.createdAt && (
                            <span className="notification-date">
                              {new Date(notif.createdAt).toLocaleString(
                                "en-IN",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          )}
                        </div>

                        <h3 className="notification-title">{notif.title}</h3>
                        <p className="notification-message">{notif.message}</p>
                      </div>

                      {!notif.read && (
                        <div className="notification-actions">
                          <button
                            type="button"
                            className="action-button edit-button"
                            disabled={markingNotificationId === notif._id}
                            onClick={() =>
                              handleMarkNotificationRead(notif._id)
                            }
                          >
                            {markingNotificationId === notif._id
                              ? "Saving..."
                              : "Mark as read"}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {auth && showClaimsPanel && (
          <section className="claims-section" id="claims-panel">
            <div className="reports-heading">
              <div>
                <span className="eyebrow">OWNERSHIP VERIFICATION</span>
                <h2>Claims & Review Queue</h2>
              </div>

              <div className="admin-controls">
                {auth.user.role === "admin" && (
                  <label className="admin-filter-label" htmlFor="claims-scope">
                    Review scope:
                    <select
                      id="claims-scope"
                      value={adminClaimsScope}
                      onChange={(e) => {
                        const nextScope = e.target.value;
                        setAdminClaimsScope(nextScope);
                        fetchClaimsData(nextScope);
                      }}
                    >
                      <option value="owned">My found items</option>
                      <option value="all">All campus claims (Admin)</option>
                    </select>
                  </label>
                )}

                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => fetchClaimsData(adminClaimsScope)}
                  disabled={claimsLoading}
                >
                  {claimsLoading ? "Loading..." : "↻ Refresh"}
                </button>
              </div>
            </div>

            {claimsError && (
              <p className="message error-message" role="alert">
                {claimsError}
              </p>
            )}

            {notice && (
              <p className="message success-message" role="status">
                {notice}
              </p>
            )}

            {claimsLoading ? (
              <p className="empty-state">Loading claims...</p>
            ) : (
              <div className="claims-grid">
                <div className="claims-column">
                  <h3 className="claims-subheading">
                    My Submitted Claims ({myClaims.length})
                  </h3>

                  {myClaims.length === 0 ? (
                    <div className="empty-state">
                      <p>You have not submitted any ownership claims yet.</p>
                    </div>
                  ) : (
                    <div className="item-list">
                      {myClaims.map((claim) => (
                        <article className="item-card claim-card" key={claim._id}>
                          <div className="item-content">
                            <div className="item-card-top">
                              <span
                                className={`claim-status-badge ${claim.status.toLowerCase()}`}
                              >
                                {claim.status}
                              </span>
                              <span className="item-status">
                                Item: {claim.item?.status || "N/A"}
                              </span>
                            </div>

                            <h3>{claim.item?.title || "Report unavailable"}</h3>

                            <p className="claim-proof-box">
                              <strong>Your verification details:</strong>{" "}
                              {claim.proofDescription}
                            </p>

                            {claim.reviewNote && (
                              <p className="claim-review-note">
                                <strong>Reviewer note:</strong>{" "}
                                {claim.reviewNote}
                              </p>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="claims-column">
                  <h3 className="claims-subheading">
                    Claims to Review ({receivedClaims.length})
                  </h3>
                  <p className="claim-review-note" style={{ marginBottom: "10px" }}>
                    Approving a claim verifies ownership, marks the report as{" "}
                    <strong>RETURNED</strong>, and automatically rejects other
                    pending claims for that item.
                  </p>

                  {receivedClaims.length === 0 ? (
                    <div className="empty-state">
                      <p>
                        No claims awaiting review on your found item reports.
                      </p>
                    </div>
                  ) : (
                    <div className="item-list">
                      {receivedClaims.map((claim) => {
                        const claimantId =
                          claim.claimant?._id?.toString() ??
                          claim.claimant?.toString() ??
                          "";
                        const canReview =
                          claim.status === "PENDING" &&
                          claimantId !== auth.user.id &&
                          claim.item?.status !== "CLOSED" &&
                          !claim.item?.moderated;

                        return (
                          <article
                            className="item-card claim-card"
                            key={claim._id}
                          >
                            <div className="item-content">
                              <div className="item-card-top">
                                <span
                                  className={`claim-status-badge ${claim.status.toLowerCase()}`}
                                >
                                  {claim.status}
                                </span>
                                <span className="item-status">
                                  Item: {claim.item?.status || "N/A"}
                                </span>
                              </div>

                              <h3>{claim.item?.title || "Report"}</h3>

                              <div className="item-meta">
                                {claim.claimant?.name && (
                                  <span>
                                    Claimant: {claim.claimant.name} (
                                    {claim.claimant.email})
                                  </span>
                                )}
                              </div>

                              <p className="claim-proof-box">
                                <strong>Identifying proof provided:</strong>{" "}
                                {claim.proofDescription}
                              </p>

                              {claim.reviewNote && (
                                <p className="claim-review-note">
                                  <strong>Review note:</strong>{" "}
                                  {claim.reviewNote}
                                </p>
                              )}

                              {canReview && (
                                <div className="item-actions">
                                  <button
                                    type="button"
                                    className="action-button approve-button"
                                    disabled={reviewingClaimId === claim._id}
                                    onClick={() =>
                                      handleReviewClaim(claim, "APPROVED")
                                    }
                                  >
                                    Approve (Mark Returned)
                                  </button>
                                  <button
                                    type="button"
                                    className="action-button delete-button"
                                    disabled={reviewingClaimId === claim._id}
                                    onClick={() =>
                                      handleReviewClaim(claim, "REJECTED")
                                    }
                                  >
                                    Reject Claim
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {auth?.user?.role === "admin" && showAdminPanel && (
          <section className="admin-section" id="admin-dashboard">
            <div className="reports-heading">
              <div>
                <span className="eyebrow">MODERATION & GOVERNANCE</span>
                <h2>Admin Dashboard</h2>
              </div>

              <div className="admin-controls">
                <label className="admin-filter-label" htmlFor="admin-status-filter">
                  Status:
                  <select
                    id="admin-status-filter"
                    value={adminStatusFilter}
                    onChange={(e) => {
                      const nextStatus = e.target.value;
                      setAdminStatusFilter(nextStatus);
                      fetchAdminItems(nextStatus, includeModerated);
                    }}
                  >
                    <option value="">All statuses</option>
                    {ITEM_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeModerated}
                    onChange={(e) => {
                      const nextMod = e.target.checked;
                      setIncludeModerated(nextMod);
                      fetchAdminItems(adminStatusFilter, nextMod);
                    }}
                  />
                  Show moderated
                </label>

                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => {
                    fetchAdminItems(adminStatusFilter, includeModerated);
                    fetchAdminAnalytics();
                  }}
                  disabled={adminLoading || adminAnalyticsLoading}
                >
                  {adminLoading || adminAnalyticsLoading
                    ? "Loading..."
                    : "↻ Refresh"}
                </button>
              </div>
            </div>

            {/* Phase 7: Server-Derived Campus Analytics & Governance Overview */}
            <div className="admin-analytics-panel" aria-label="Campus analytics overview">
              <div className="admin-analytics-header">
                <h3 className="claims-subheading">
                  Campus Analytics & Governance Overview
                </h3>
                <span className="admin-analytics-caption">
                  Live server-derived aggregations (privacy-safe: no passwords or private claim proofs)
                </span>
              </div>

              {adminAnalyticsLoading && !adminAnalytics ? (
                <p className="empty-state" role="status">
                  Loading campus analytics...
                </p>
              ) : adminAnalyticsError ? (
                <div className="matches-error-box" role="alert">
                  <p>{adminAnalyticsError}</p>
                  <button
                    type="button"
                    className="action-button edit-button"
                    onClick={() => fetchAdminAnalytics()}
                  >
                    Retry Analytics
                  </button>
                </div>
              ) : adminAnalytics ? (
                <>
                  <div className="admin-kpi-grid">
                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Total Users</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.totalUsers ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        {adminAnalytics.totals?.studentUsers ?? 0} students ·{" "}
                        {adminAnalytics.totals?.adminUsers ?? 0} admins
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Lost Reports</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.lostReports ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        Active campus lost items
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Found Reports</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.foundReports ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        Active campus found items
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Open Reports</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.openReports ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        {adminAnalytics.totals?.claimPendingReports ?? 0} claim
                        pending
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Pending Claims</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.pendingClaims ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        {adminAnalytics.totals?.totalClaims ?? 0} total claims
                        submitted
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Completed Returns</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.completedReturns ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        {adminAnalytics.totals?.approvedClaims ?? 0} verified
                        handovers
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Moderated Reports</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.moderatedReports ?? 0}
                      </strong>
                      <small className="admin-kpi-sub">
                        {adminAnalytics.totals?.closedReports ?? 0} active
                        closed
                      </small>
                    </div>

                    <div className="admin-kpi-card">
                      <span className="admin-kpi-label">Community XP</span>
                      <strong className="admin-kpi-value">
                        {adminAnalytics.totals?.totalXpAwarded ?? 0} XP
                      </strong>
                      <small className="admin-kpi-sub">
                        Across {adminAnalytics.totals?.totalRewardEvents ?? 0}{" "}
                        verified events
                      </small>
                    </div>
                  </div>

                  <div className="admin-breakdowns-grid">
                    <div className="admin-breakdown-box">
                      <h4>Report Status Breakdown</h4>
                      <div className="admin-pill-list">
                        {ITEM_STATUSES.map((st) => (
                          <span key={st} className="admin-metric-pill">
                            <strong>{st}:</strong>{" "}
                            {adminAnalytics.breakdowns?.reportsByStatus?.[st] ??
                              0}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="admin-breakdown-box">
                      <h4>Claim Status Breakdown</h4>
                      <div className="admin-pill-list">
                        {["PENDING", "APPROVED", "REJECTED"].map((st) => (
                          <span key={st} className="admin-metric-pill">
                            <strong>{st}:</strong>{" "}
                            {adminAnalytics.breakdowns?.claimsByStatus?.[st] ??
                              0}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="admin-breakdown-box">
                      <h4>Active Reports by Category</h4>
                      {(adminAnalytics.breakdowns?.reportsByCategory || [])
                        .length === 0 ? (
                        <p className="rewards-empty-note">
                          No active category data yet.
                        </p>
                      ) : (
                        <div className="admin-pill-list">
                          {(
                            adminAnalytics.breakdowns?.reportsByCategory || []
                          ).map((row) => (
                            <span
                              key={row.category}
                              className="admin-metric-pill"
                            >
                              <strong>{row.category}:</strong> {row.count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="admin-recent-grid">
                    <div className="admin-recent-column">
                      <h4>Recent Reports</h4>
                      {(adminAnalytics.recentActivity?.recentReports || [])
                        .length === 0 ? (
                        <p className="rewards-empty-note">No recent reports.</p>
                      ) : (
                        <ul className="admin-recent-list">
                          {(
                            adminAnalytics.recentActivity?.recentReports || []
                          ).map((r) => (
                            <li key={r._id} className="admin-recent-item">
                              <div>
                                <strong>{r.title}</strong>
                                <span className="admin-recent-sub">
                                  {r.type} · {r.category} · {r.location} (by{" "}
                                  {r.reporterName})
                                </span>
                              </div>
                              <span className="item-status">
                                {r.moderated ? "MODERATED" : r.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="admin-recent-column">
                      <h4>Recent Claims</h4>
                      {(adminAnalytics.recentActivity?.recentClaims || [])
                        .length === 0 ? (
                        <p className="rewards-empty-note">No recent claims.</p>
                      ) : (
                        <ul className="admin-recent-list">
                          {(
                            adminAnalytics.recentActivity?.recentClaims || []
                          ).map((c) => (
                            <li key={c._id} className="admin-recent-item">
                              <div>
                                <strong>{c.itemTitle}</strong>
                                <span className="admin-recent-sub">
                                  Claimant: {c.claimantName}
                                  {c.reviewerName
                                    ? ` · Reviewed by ${c.reviewerName}`
                                    : ""}
                                </span>
                              </div>
                              <span
                                className={`claim-status-badge ${(
                                  c.status || "pending"
                                ).toLowerCase()}`}
                              >
                                {c.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="admin-recent-column">
                      <h4>Recent Moderation Activity</h4>
                      {(adminAnalytics.recentActivity?.recentModeration || [])
                        .length === 0 ? (
                        <p className="rewards-empty-note">
                          No moderated reports yet.
                        </p>
                      ) : (
                        <ul className="admin-recent-list">
                          {(
                            adminAnalytics.recentActivity?.recentModeration ||
                            []
                          ).map((m) => (
                            <li key={m._id} className="admin-recent-item">
                              <div>
                                <strong>{m.title}</strong>
                                <span className="admin-recent-sub">
                                  By {m.moderatorName}
                                  {m.moderationReason
                                    ? ` — "${m.moderationReason}"`
                                    : ""}
                                </span>
                              </div>
                              <span className="moderated-badge">REMOVED</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <h3 className="claims-subheading" style={{ marginTop: "20px" }}>
              Report Moderation Queue ({adminItems.length})
            </h3>

            {adminError && (
              <p className="message error-message" role="alert">
                {adminError}
              </p>
            )}

            {notice && (
              <p className="message success-message" role="status">
                {notice}
              </p>
            )}

            {adminLoading && (
              <p className="empty-state">
                Loading moderation queue...
              </p>
            )}

            {!adminLoading && adminUnauthorized && (
              <div className="empty-state" role="alert">
                <h3>Unauthorized</h3>
                <p>
                  You do not have administrator permissions to view or
                  moderate campus reports.
                </p>
              </div>
            )}

            {!adminLoading &&
              !adminUnauthorized &&
              !adminError &&
              adminItems.length === 0 && (
                <div className="empty-state">
                  <h3>No matching reports</h3>
                  <p>No reports match the current moderation filters.</p>
                </div>
              )}

            {!adminLoading && !adminUnauthorized && adminItems.length > 0 && (
              <div className="item-list">
                {adminItems.map((item) => (
                  <article
                    className={`item-card ${
                      item.moderated ? "moderated-card" : ""
                    }`}
                    key={item._id}
                  >
                    <div className="item-icon" aria-hidden="true">
                      {getCategoryIcon(item.category, item.title)}
                    </div>

                    <div className="item-content">
                      <div className="item-card-top">
                        <div className="badge-group">
                          <span
                            className={`type-badge ${item.type.toLowerCase()}`}
                          >
                            {item.type === "LOST"
                              ? "LOST ITEM"
                              : "FOUND ITEM"}
                          </span>

                          {item.moderated && (
                            <span className="moderated-badge">
                              MODERATED / HIDDEN
                            </span>
                          )}
                        </div>

                        <span className="item-status">{item.status}</span>
                      </div>

                      <h3>{item.title}</h3>

                      <p className="item-description">
                        {item.description}
                      </p>

                      <div className="item-meta">
                        <span>⌖ {item.location}</span>
                        <span>
                          {new Date(item.itemDate).toLocaleDateString(
                            "en-IN",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </span>
                        {item.reportedBy?.email && (
                          <span>
                            Reporter: {item.reportedBy.name} (
                            {item.reportedBy.email})
                          </span>
                        )}
                      </div>

                      {item.moderated && item.moderationReason && (
                        <p className="moderation-note">
                          Moderation note: {item.moderationReason}
                        </p>
                      )}

                      <div className="admin-item-actions">
                        <span className="category-label">
                          {item.category}
                        </span>

                        <div className="admin-action-controls">
                          <label
                            className="status-select-label"
                            htmlFor={`status-${item._id}`}
                          >
                            Status:
                            <select
                              id={`status-${item._id}`}
                              value={item.status}
                              disabled={moderatingId === item._id}
                              onChange={(e) =>
                                handleAdminStatusChange(
                                  item._id,
                                  e.target.value
                                )
                              }
                            >
                              {ITEM_STATUSES.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          </label>

                          {!item.moderated && (
                            <button
                              type="button"
                              className="action-button delete-button"
                              disabled={moderatingId === item._id}
                              onClick={() =>
                                handleAdminModerateRemove(item)
                              }
                            >
                              Remove (Moderate)
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="content-grid">
          <section className="form-card" id="report-form">
            {auth ? (
              <>
                <div className="section-heading">
                  <span className="eyebrow">CONTRIBUTE</span>
                  <h2>Report an item</h2>
                  <p>
                    Share the details so the community can help.
                  </p>
                </div>

                <form onSubmit={handleSubmit}>
                  <label htmlFor="type">Report type</label>

                  <div
                    className="report-type-toggle"
                    role="group"
                    aria-label="Select report type"
                  >
                    <button
                      type="button"
                      className={`type-toggle-btn lost ${
                        form.type === "LOST" ? "active" : ""
                      }`}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, type: "LOST" }))
                      }
                    >
                      ◎ I lost something
                    </button>
                    <button
                      type="button"
                      className={`type-toggle-btn found ${
                        form.type === "FOUND" ? "active" : ""
                      }`}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, type: "FOUND" }))
                      }
                    >
                      ✓ I found something
                    </button>
                  </div>

                  <select
                    id="type"
                    name="type"
                    value={form.type}
                    onChange={handleChange}
                    required
                  >
                    <option value="LOST">I lost something</option>
                    <option value="FOUND">I found something</option>
                  </select>

                  <label htmlFor="title">Item name</label>

                  <input
                    id="title"
                    name="title"
                    value={form.title}
                    onChange={handleChange}
                    placeholder="e.g. Black wallet"
                    maxLength={100}
                    required
                  />

                  <label htmlFor="category">Category</label>

                  <select
                    id="category"
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    required
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="description">Description</label>

                  <textarea
                    id="description"
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="Describe the item's appearance..."
                    maxLength={1000}
                    rows={4}
                    required
                  />

                  <label htmlFor="location">Campus location</label>

                  <input
                    id="location"
                    name="location"
                    value={form.location}
                    onChange={handleChange}
                    placeholder="e.g. Central Library"
                    maxLength={100}
                    required
                  />

                  <label htmlFor="itemDate">Date lost or found</label>

                  <input
                    id="itemDate"
                    name="itemDate"
                    type="date"
                    value={form.itemDate}
                    onChange={handleChange}
                    max={getToday()}
                    required
                  />

                  {error && (
                    <p className="message error-message" role="alert">
                      {error}
                    </p>
                  )}

                  {notice && (
                    <p
                      className="message success-message"
                      role="status"
                    >
                      {notice}
                    </p>
                  )}

                  <button
                    className="submit-button"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? "Submitting..." : "Submit report →"}
                  </button>
                </form>
              </>
            ) : (
              <div className="sign-in-prompt">
                <span className="eyebrow">ACCOUNT REQUIRED</span>
                <h2>Sign in to report an item</h2>
                <p>
                  Continue with your Google account before submitting a
                  lost or found report.
                </p>

                <a className="primary-link" href="#account">
                  Continue with Google
                </a>
              </div>
            )}
          </section>

          <section className="reports-section" id="reports">
            <div className="reports-heading">
              <div>
                <span className="eyebrow">
                  {showMyReports ? "YOUR ACCOUNT" : "CAMPUS COMMUNITY"}
                </span>
                <h2>
                  {showMyReports ? "My Reports" : "Recent reports"}
                </h2>
              </div>

              {showMyReports ? (
                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => {
                    setShowMyReports(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  ← All reports
                </button>
              ) : (
                <button
                  className="refresh-button"
                  type="button"
                  onClick={loadItems}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "↻ Refresh"}
                </button>
              )}
            </div>

            {!showMyReports && (
              <div className="filters-panel" aria-label="Search and filter reports">
                <div className="search-row">
                  <input
                    type="search"
                    className="search-input"
                    aria-label="Search reports by title or description"
                    placeholder="Search by item name or description..."
                    value={searchInput}
                    maxLength={100}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />

                  <input
                    type="text"
                    className="location-filter-input"
                    aria-label="Filter by campus location"
                    placeholder="Location (e.g. Library)..."
                    value={locationInput}
                    maxLength={100}
                    onChange={(e) => setLocationInput(e.target.value)}
                  />
                </div>

                <div className="filters-grid">
                  <select
                    aria-label="Filter by report type"
                    value={filterType}
                    onChange={(e) => {
                      setFilterType(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All types (Lost & Found)</option>
                    <option value="LOST">Lost items only</option>
                    <option value="FOUND">Found items only</option>
                  </select>

                  <select
                    aria-label="Filter by category"
                    value={filterCategory}
                    onChange={(e) => {
                      setFilterCategory(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All categories</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by status"
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All statuses</option>
                    {ITEM_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Sort reports"
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="newest">Sort: Newest first</option>
                    <option value="oldest">Sort: Oldest first</option>
                    <option value="itemDate_desc">
                      Sort: Item date (newest)
                    </option>
                    <option value="itemDate_asc">
                      Sort: Item date (oldest)
                    </option>
                  </select>
                </div>

                <div className="date-range-row">
                  <label className="date-filter-label">
                    From date:
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || getToday()}
                      onChange={(e) => {
                        setDateFrom(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>

                  <label className="date-filter-label">
                    To date:
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      max={getToday()}
                      onChange={(e) => {
                        setDateTo(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="clear-filters-button"
                      onClick={handleClearFilters}
                    >
                      ✕ Clear filters
                    </button>
                  )}
                </div>

                <div className="results-summary" role="status">
                  <span>
                    {loading
                      ? "Searching reports..."
                      : pagination.totalItems === 0
                        ? "0 matching reports"
                        : `Showing ${
                            (pagination.currentPage - 1) *
                              pagination.pageSize +
                            1
                          }–${Math.min(
                            pagination.currentPage * pagination.pageSize,
                            pagination.totalItems
                          )} of ${pagination.totalItems} report${
                            pagination.totalItems === 1 ? "" : "s"
                          }`}
                  </span>
                </div>
              </div>
            )}

            {loading && (
              <div
                className="skeleton-list"
                role="status"
                aria-label="Loading reports"
              >
                {[1, 2, 3].map((sk) => (
                  <div className="skeleton-card" key={sk}>
                    <div className="skeleton-icon" />
                    <div className="skeleton-body">
                      <div className="skeleton-line short" />
                      <div className="skeleton-line title" />
                      <div className="skeleton-line medium" />
                      <div className="skeleton-line meta" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && error && displayedItems.length === 0 && (
              <div className="empty-state">
                <h3>Unable to load reports</h3>
                <p>{error}</p>
                {!showMyReports && (
                  <button type="button" onClick={loadItems}>
                    Try again
                  </button>
                )}
              </div>
            )}

            {!loading && !error && displayedItems.length === 0 && (
              <div className="empty-state">
                <h3>
                  {showMyReports
                    ? "No reports yet"
                    : hasActiveFilters
                      ? "No matching reports"
                      : "No reports yet"}
                </h3>
                <p>
                  {showMyReports
                    ? "You have not submitted any reports."
                    : hasActiveFilters
                      ? "Try adjusting your search keywords or clearing your active filters."
                      : "Be the first to report a lost or found item."}
                </p>
                {!showMyReports && hasActiveFilters && (
                  <button type="button" onClick={handleClearFilters}>
                    Clear all filters
                  </button>
                )}
              </div>
            )}

            {!loading && error && displayedItems.length > 0 && (
              <p
                className="message error-message"
                role="alert"
                style={{ marginBottom: "14px" }}
              >
                {error}
              </p>
            )}

            {!loading && notice && (
              <p
                className="message success-message"
                role="status"
                style={{ marginBottom: "14px" }}
              >
                {notice}
              </p>
            )}

            <div className="item-list">
              {displayedItems.map((item) => {
                // reportedBy arrives as a raw ObjectId string from GET /api/items
                // (the route does not populate the field). Compare as strings.
                const reportedById =
                  item.reportedBy?._id?.toString() ??
                  item.reportedBy?.toString() ??
                  "";
                const isOwner =
                  auth !== null &&
                  reportedById !== "" &&
                  reportedById === auth.user.id;
                const canModify = isOwner && item.status === "OPEN";
                const canClaim =
                  auth !== null &&
                  !isOwner &&
                  item.type === "FOUND" &&
                  (item.status === "OPEN" ||
                    item.status === "CLAIM_PENDING");
                const canFindMatches =
                  auth !== null &&
                  !item.moderated &&
                  (item.status === "OPEN" ||
                    item.status === "MATCHED" ||
                    item.status === "CLAIM_PENDING");
                const isMatchesOpen = Boolean(openMatchItemIds[item._id]);
                const itemMatchState = matchesByItem[item._id];
                const isExpanded = Boolean(expandedItemIds[item._id]);
                const isEditing = editingItemId === item._id;

                return (
                  <article
                    id={`item-card-${item._id}`}
                    className={`item-card ${isOwner ? "owner-card" : ""}`}
                    key={item._id}
                  >
                    <div
                      className={`item-icon ${item.type.toLowerCase()}`}
                      aria-hidden="true"
                    >
                      {getCategoryIcon(item.category, item.title)}
                    </div>

                    <div className="item-content">
                      <div className="item-card-top">
                        <div className="badge-group">
                          <span
                            className={`type-badge ${item.type.toLowerCase()}`}
                          >
                            {item.type === "LOST"
                              ? "LOST ITEM"
                              : "FOUND ITEM"}
                          </span>

                          <span className="category-label">
                            {item.category}
                          </span>

                          {isOwner && (
                            <span className="owner-pill">YOUR REPORT</span>
                          )}
                        </div>

                        <span
                          className={`item-status status-${item.status.toLowerCase()}`}
                        >
                          {item.status.replace("_", " ")}
                        </span>
                      </div>

                      <h3>{item.title}</h3>

                      <p className="item-description">
                        {item.description}
                      </p>

                      <div className="item-meta">
                        <span className="meta-chip">
                          <span aria-hidden="true">⌖</span> {item.location}
                        </span>
                        <span className="meta-chip">
                          <span aria-hidden="true">◷</span>{" "}
                          {new Date(item.itemDate).toLocaleDateString(
                            "en-IN",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </span>
                        <button
                          type="button"
                          className="details-toggle-button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleItemDetails(item._id)}
                        >
                          {isExpanded ? "Hide details ▲" : "Report details ▼"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="item-detail-drawer">
                          <div className="item-detail-grid">
                            <div>
                              <span className="detail-label">Report Type</span>
                              <strong>
                                {item.type === "LOST"
                                  ? "Lost Belonging Report"
                                  : "Found Item Report"}
                              </strong>
                            </div>
                            <div>
                              <span className="detail-label">Category</span>
                              <strong>{item.category}</strong>
                            </div>
                            <div>
                              <span className="detail-label">Current Status</span>
                              <strong>{item.status}</strong>
                            </div>
                            <div>
                              <span className="detail-label">Reported On</span>
                              <strong>
                                {item.createdAt
                                  ? new Date(item.createdAt).toLocaleDateString(
                                      "en-IN",
                                      {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      }
                                    )
                                  : "Verified"}
                              </strong>
                            </div>
                          </div>
                        </div>
                      )}

                      {canModify && isEditing && (
                        <form
                          className="inline-edit-form"
                          onSubmit={(e) => handleSaveEdit(e, item._id)}
                        >
                          <div className="inline-edit-header">
                            <strong>Edit Open Report</strong>
                            <span>Only open reports you created can be edited</span>
                          </div>

                          <div className="inline-edit-grid">
                            <div>
                              <label htmlFor={`edit-title-${item._id}`}>
                                Item name
                              </label>
                              <input
                                id={`edit-title-${item._id}`}
                                name="title"
                                value={editForm.title}
                                onChange={handleEditFormChange}
                                maxLength={100}
                                required
                              />
                            </div>

                            <div>
                              <label htmlFor={`edit-category-${item._id}`}>
                                Category
                              </label>
                              <select
                                id={`edit-category-${item._id}`}
                                name="category"
                                value={editForm.category}
                                onChange={handleEditFormChange}
                                required
                              >
                                {CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label htmlFor={`edit-location-${item._id}`}>
                                Campus location
                              </label>
                              <input
                                id={`edit-location-${item._id}`}
                                name="location"
                                value={editForm.location}
                                onChange={handleEditFormChange}
                                maxLength={100}
                                required
                              />
                            </div>

                            <div>
                              <label htmlFor={`edit-date-${item._id}`}>
                                Date lost or found
                              </label>
                              <input
                                id={`edit-date-${item._id}`}
                                name="itemDate"
                                type="date"
                                value={editForm.itemDate}
                                max={getToday()}
                                onChange={handleEditFormChange}
                                required
                              />
                            </div>
                          </div>

                          <div>
                            <label htmlFor={`edit-desc-${item._id}`}>
                              Description
                            </label>
                            <textarea
                              id={`edit-desc-${item._id}`}
                              name="description"
                              rows={3}
                              maxLength={1000}
                              value={editForm.description}
                              onChange={handleEditFormChange}
                              required
                            />
                          </div>

                          <div className="item-actions">
                            <button
                              type="submit"
                              className="action-button approve-button"
                              disabled={editSubmitting}
                            >
                              {editSubmitting ? "Saving..." : "Save changes"}
                            </button>
                            <button
                              type="button"
                              className="action-button"
                              onClick={handleCancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {canModify && !isEditing && (
                        <div className="item-actions">
                          <button
                            type="button"
                            className="action-button edit-button"
                            onClick={() => handleStartEdit(item)}
                          >
                            Edit Report
                          </button>
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => handleEdit(item)}
                            title="Quick prompt edit"
                          >
                            Quick Edit
                          </button>
                          <button
                            type="button"
                            className="action-button delete-button"
                            onClick={() => handleDelete(item._id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}

                      {canClaim && (
                        <div className="claim-action-area">
                          {claimingItemId === item._id ? (
                            <form
                              className="inline-claim-form"
                              onSubmit={(e) =>
                                handleSubmitClaim(e, item._id)
                              }
                            >
                              <label htmlFor={`claim-proof-${item._id}`}>
                                Describe unique identifying details to verify
                                ownership (do not share passwords or sensitive
                                ID numbers):
                              </label>
                              <textarea
                                id={`claim-proof-${item._id}`}
                                rows={3}
                                minLength={10}
                                maxLength={1000}
                                required
                                placeholder="e.g. Brand, lock-screen wallpaper, specific sticker, or contents inside..."
                                value={claimProofText}
                                onChange={(e) =>
                                  setClaimProofText(e.target.value)
                                }
                              />
                              {error && (
                                <p
                                  className="message error-message"
                                  role="alert"
                                >
                                  {error}
                                </p>
                              )}
                              <div className="item-actions">
                                <button
                                  type="submit"
                                  className="action-button approve-button"
                                  disabled={claimSubmitting}
                                >
                                  {claimSubmitting
                                    ? "Submitting..."
                                    : "Submit claim"}
                                </button>
                                <button
                                  type="button"
                                  className="action-button"
                                  onClick={() => {
                                    setClaimingItemId("");
                                    setClaimProofText("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="item-actions">
                              <button
                                type="button"
                                className="action-button edit-button"
                                onClick={() => {
                                  setClaimingItemId(item._id);
                                  setClaimProofText("");
                                  setError("");
                                  setNotice("");
                                }}
                              >
                                Claim this item
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {canFindMatches && (
                        <div className="match-action-area">
                          <div className="item-actions">
                            <button
                              type="button"
                              className="action-button match-button"
                              aria-expanded={isMatchesOpen}
                              aria-controls={`matches-panel-${item._id}`}
                              disabled={Boolean(itemMatchState?.loading)}
                              onClick={() => handleToggleMatches(item)}
                            >
                              {itemMatchState?.loading
                                ? "Finding Matches..."
                                : isMatchesOpen
                                  ? "Hide Possible Matches"
                                  : "Find Possible Matches"}
                            </button>

                            {isMatchesOpen &&
                              itemMatchState?.fetched &&
                              !itemMatchState?.loading && (
                                <button
                                  type="button"
                                  className="action-button"
                                  onClick={() =>
                                    handleFindMatches(item._id, {
                                      forceRefresh: true,
                                    })
                                  }
                                >
                                  Refresh Matches
                                </button>
                              )}
                          </div>

                          {isMatchesOpen && (
                            <section
                              id={`matches-panel-${item._id}`}
                              className="matches-panel"
                              aria-label={`Possible matches for ${item.title}`}
                            >
                              <div className="matches-panel-header">
                                <div>
                                  <h4 className="matches-panel-title">
                                    Possible{" "}
                                    {item.type === "LOST"
                                      ? "Found"
                                      : "Lost"}{" "}
                                    Matches
                                  </h4>
                                  <p className="matches-disclaimer">
                                    {itemMatchState?.disclaimer ||
                                      "Match scores are heuristic suggestions out of 100 based on report similarity (not a probability or proof of ownership)."}
                                  </p>
                                </div>
                              </div>

                              {itemMatchState?.loading && (
                                <p
                                  className="matches-state-text"
                                  role="status"
                                >
                                  Scanning active reports for plausible
                                  matches...
                                </p>
                              )}

                              {!itemMatchState?.loading &&
                                itemMatchState?.error && (
                                  <div
                                    className="matches-error-box"
                                    role="alert"
                                  >
                                    <p>{itemMatchState.error}</p>
                                    <button
                                      type="button"
                                      className="action-button edit-button"
                                      onClick={() =>
                                        handleFindMatches(item._id, {
                                          forceRefresh: true,
                                        })
                                      }
                                    >
                                      Retry
                                    </button>
                                  </div>
                                )}

                              {!itemMatchState?.loading &&
                                !itemMatchState?.error &&
                                itemMatchState?.fetched &&
                                itemMatchState.matches.length === 0 && (
                                  <p
                                    className="matches-state-text"
                                    role="status"
                                  >
                                    No plausible{" "}
                                    {item.type === "LOST"
                                      ? "FOUND"
                                      : "LOST"}{" "}
                                    matches met the similarity threshold yet.
                                  </p>
                                )}

                              {!itemMatchState?.loading &&
                                !itemMatchState?.error &&
                                itemMatchState?.matches?.length > 0 && (
                                  <div className="matches-list">
                                    {itemMatchState.matches.map((matchEntry) => {
                                      const candidate = matchEntry.item || {};
                                      const score =
                                        typeof matchEntry.matchScore ===
                                        "number"
                                          ? matchEntry.matchScore
                                          : 0;
                                      const scoreTier =
                                        score >= 70
                                          ? "high"
                                          : score >= 40
                                            ? "medium"
                                            : "low";
                                      const reasons = Array.isArray(
                                        matchEntry.reasons
                                      )
                                        ? matchEntry.reasons
                                        : [];

                                      return (
                                        <div
                                          className="match-card"
                                          key={candidate._id || candidate.title}
                                        >
                                          <div className="match-card-top">
                                            <div className="match-badges">
                                              {candidate.type && (
                                                <span
                                                  className={`type-badge ${candidate.type.toLowerCase()}`}
                                                >
                                                  {candidate.type === "LOST"
                                                    ? "LOST ITEM"
                                                    : "FOUND ITEM"}
                                                </span>
                                              )}
                                              {candidate.status && (
                                                <span className="item-status">
                                                  {candidate.status}
                                                </span>
                                              )}
                                            </div>

                                            <span
                                              className={`match-score-badge ${scoreTier}`}
                                              title="Rule-based heuristic similarity score out of 100 (not a probability)"
                                            >
                                              Heuristic score: {score}/100
                                            </span>
                                          </div>

                                          <h5 className="match-candidate-title">
                                            {candidate.title}
                                          </h5>

                                          <div className="item-meta match-candidate-meta">
                                            {candidate.category && (
                                              <span className="category-label">
                                                {candidate.category}
                                              </span>
                                            )}
                                            {candidate.location && (
                                              <span>
                                                ⌖ {candidate.location}
                                              </span>
                                            )}
                                            {candidate.itemDate && (
                                              <span>
                                                {new Date(
                                                  candidate.itemDate
                                                ).toLocaleDateString("en-IN", {
                                                  day: "numeric",
                                                  month: "short",
                                                  year: "numeric",
                                                })}
                                              </span>
                                            )}
                                          </div>

                                          {reasons.length > 0 && (
                                            <div className="match-reasons">
                                              <span className="match-reasons-label">
                                                Why this matched:
                                              </span>
                                              <ul className="match-reasons-list">
                                                {reasons.map((reason, idx) => (
                                                  <li
                                                    key={`${candidate._id || idx}-reason-${idx}`}
                                                    className="match-reason-pill"
                                                  >
                                                    {reason}
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}

                                          <div className="item-actions match-card-actions">
                                            <button
                                              type="button"
                                              className="action-button edit-button"
                                              onClick={() =>
                                                handleViewCandidateReport(
                                                  candidate
                                                )
                                              }
                                            >
                                              View candidate in reports →
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {!showMyReports &&
              !loading &&
              !error &&
              pagination.totalPages > 1 && (
                <nav
                  className="pagination-bar"
                  aria-label="Reports pagination"
                >
                  <button
                    type="button"
                    className="pagination-button"
                    disabled={!pagination.hasPrevPage || loading}
                    onClick={() =>
                      setPage((prev) => Math.max(1, prev - 1))
                    }
                  >
                    ← Previous
                  </button>

                  <span className="pagination-info">
                    Page <strong>{pagination.currentPage}</strong> of{" "}
                    <strong>{pagination.totalPages}</strong>
                  </span>

                  <button
                    type="button"
                    className="pagination-button"
                    disabled={!pagination.hasNextPage || loading}
                    onClick={() =>
                      setPage((prev) =>
                        Math.min(pagination.totalPages, prev + 1)
                      )
                    }
                  >
                    Next →
                  </button>
                </nav>
              )}
          </section>
        </div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <a className="footer-logo" href="#home">
            LostLink
          </a>
          <div className="footer-meta">
            <span>{CAMPUS_NAME}</span>
            <span className="footer-dot" aria-hidden="true">
              ·
            </span>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <span className="footer-dot" aria-hidden="true">
              ·
            </span>
            <a href="#reports">Privacy</a>
            <span className="footer-dot" aria-hidden="true">
              ·
            </span>
            <a href="#reports">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
