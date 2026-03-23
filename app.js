import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const APP_STORAGE_KEY = "proyecto-green-state-v1";
const SESSION_STORAGE_KEY = "proyecto-green-session-v1";
const PRESENCE_STORAGE_KEY = "proyecto-green-presence-session-v1";
const FIREBASE_CONFIG = {
  projectId: "luro-control",
  appId: "1:541972603526:web:559dc85853c88d8c18e707",
  storageBucket: "luro-control.firebasestorage.app",
  apiKey: "AIzaSyDhEiZnBKsX-SIB_JjTHWkuSa1Ks_mrFxs",
  authDomain: "luro-control.firebaseapp.com",
  messagingSenderId: "541972603526",
  measurementId: "G-DHN6FZW3LL",
};
const FIRESTORE_DATABASE_ID = "proyecto-green";
const CLOUD_STATE_COLLECTION = "project_green";
const CLOUD_STATE_DOCUMENT = "shared_state";
const PRESENCE_COLLECTION = "project_green_presence";
const PRESENCE_HEARTBEAT_MS = 15000;
const PRESENCE_TTL_MS = 45000;
const CREDENTIALS = {
  username: "Green",
  password: "160623",
};

const DESTINATIONS = [
  {
    zone: "Venezuela",
    branches: ["Green Salad", "La Pasta", "X"],
  },
  {
    zone: "Jacobo",
    branches: ["Green Salad", "La Pasta", "X"],
  },
];
const COLLABORATOR_ROLES = [
  { value: "cocinero", label: "Cocinero" },
  { value: "utility", label: "Utility" },
  { value: "lider_de_turno", label: "Lider de turno" },
  { value: "encargado", label: "Encargado" },
  { value: "administrador", label: "Administrador" },
];
const BRANCH_LOCATIONS = [
  { id: "venezuela", name: "Venezuela" },
  { id: "bella-vista", name: "Bella Vista" },
  { id: "jacobo", name: "Jacobo" },
  { id: "la-parrillada", name: "La parrillada" },
];
const ALL_BRANCHES_OPTION = "Todas";
const BRANCH_BRANDS = ["Green Salad", "La Pasta"];
const PRODUCT_DEFAULT_UNIT = "Libras";
const app = document.querySelector("#app");
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const firestore = getFirestore(firebaseApp, FIRESTORE_DATABASE_ID);
const cloudStateRef = doc(firestore, CLOUD_STATE_COLLECTION, CLOUD_STATE_DOCUMENT);
const presenceCollectionRef = collection(firestore, PRESENCE_COLLECTION);
const presenceSessionId = loadPresenceSessionId();

let state = loadStoredState();
let session = loadStoredSession();
const cloudSync = {
  enabled: true,
  initialized: false,
  applyingRemoteState: false,
  writeTimerId: null,
  retryTimerId: null,
  retryCount: 0,
  lastSnapshotSignature: "",
  unsubscribe: null,
  status: "connecting",
  statusMessage: "Conectando sincronización en vivo...",
};
const ui = {
  currentModule: "home",
  coldRoomSection: "equipo",
  kitchenSection: "panel",
  selectedBranchId: "",
  selectedBranchBrand: "",
  selectedBranchStorage: false,
  selectedKitchenBranchId: "",
  selectedKitchenBrand: "",
  productMatchId: "",
  pendingAssignmentProductId: "",
  productProductionPrompt: false,
  productProductionProductId: "",
  kitchenOrderPrompt: false,
  kitchenOrderPromptBranchId: "",
  kitchenOrderPromptBrandName: "",
  editingCollaboratorId: null,
  editingProductId: null,
  collaboratorPasswordPrompt: false,
  collaboratorPasswordCollaboratorId: "",
  flash: null,
  flashTimerId: null,
  flashToken: 0,
  productSearch: "",
  historySearch: "",
  historyDate: "",
  loginUsername: "",
  coldRoomAccessPrompt: false,
  ordersAccessPrompt: false,
  historyDeletePrompt: false,
  historyDeleteSource: "",
  techPanelPrompt: false,
  exitDraft: {
    productId: "",
    quantity: "",
    destination: "",
    date: "",
    observation: "",
  },
};
const presenceSync = {
  records: [],
  unsubscribe: null,
  heartbeatTimerId: null,
  identityKey: "",
  expiryTimerId: null,
  activeSignature: "",
};

if (reconcileNotificationsWithInventory()) {
  saveState();
}

window.addEventListener("error", (event) => {
  renderFatalError(event.error || event.message || "Error desconocido");
});
window.addEventListener("unhandledrejection", (event) => {
  renderFatalError(event.reason || "Promesa rechazada sin controlar");
});

try {
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  app.addEventListener("input", handleInput);
  window.setInterval(updateLiveTimers, 1000);
  window.addEventListener("online", () => {
    if (cloudSync.status !== "online") {
      void initializeCloudSync({ retrying: true });
    }
  });
  window.addEventListener("resize", syncLayoutOffsets);
  window.addEventListener("pagehide", () => {
    void clearPresenceDocument();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void pushPresenceHeartbeat(true);
    }
  });

  render();
  void initializeCloudSync();
  void initializePresenceSync();
} catch (error) {
  renderFatalError(error);
}

function defaultState() {
  return {
    products: [],
    collaborators: [],
    assignments: [],
    history: [],
    notifications: [],
    branchNeeds: defaultBranchNeeds(),
    branchCatalogs: defaultBranchCatalogs(),
    branchStorage: defaultBranchStorage(),
    branchConsumption: defaultBranchConsumption(),
    branchDailyQuantities: defaultBranchDailyQuantities(),
    kitchenOrders: [],
  };
}

function defaultBranchNeeds() {
  return BRANCH_LOCATIONS.flatMap((branch) =>
    BRANCH_BRANDS.map((brandName) => ({
      branchId: branch.id,
      brandName,
      productIds: [],
      stockByProductId: {},
      updatedAt: "",
    })),
  );
}

function defaultBranchCatalogs() {
  return BRANCH_LOCATIONS.flatMap((branch) =>
    BRANCH_BRANDS.map((brandName) => ({
      branchId: branch.id,
      brandName,
      productIds: [],
      updatedAt: "",
    })),
  );
}

function loadStoredState() {
  try {
    const raw = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "{}");
    return sanitizeState(raw);
  } catch (error) {
    return defaultState();
  }
}

function loadStoredSession() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "{}");
    return {
      authenticated: raw.authenticated === true,
      activeCollaboratorId: String(raw.activeCollaboratorId || ""),
      loginRole: normalizeCollaboratorRole(raw.loginRole),
      loginCollaboratorId: String(raw.loginCollaboratorId || ""),
      coldRoomAuthorized: raw.coldRoomAuthorized === true,
      coldRoomAccessRole: normalizeCollaboratorRole(raw.coldRoomAccessRole),
      coldRoomAccessCollaboratorId: String(raw.coldRoomAccessCollaboratorId || ""),
      ordersAuthorized: raw.ordersAuthorized === true,
      ordersAccessCollaboratorId: String(raw.ordersAccessCollaboratorId || ""),
    };
  } catch (error) {
    return {
      authenticated: false,
      activeCollaboratorId: "",
      loginRole: "",
      loginCollaboratorId: "",
      coldRoomAuthorized: false,
      coldRoomAccessRole: "",
      coldRoomAccessCollaboratorId: "",
      ordersAuthorized: false,
      ordersAccessCollaboratorId: "",
    };
  }
}

function loadPresenceSessionId() {
  try {
    const existingId = sessionStorage.getItem(PRESENCE_STORAGE_KEY);
    if (existingId) {
      return existingId;
    }

    const nextId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : createId("presence-session");
    sessionStorage.setItem(PRESENCE_STORAGE_KEY, nextId);
    return nextId;
  } catch (error) {
    return createId("presence-session");
  }
}

function sanitizeState(rawState) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const products = Array.isArray(source.products)
    ? source.products.map((product) => ({
        id: product.id || createId("product"),
        name: String(product.name || "").trim(),
        unit: String(product.unit || "").trim(),
        category: String(product.category || "").trim(),
        stockCurrent: normalizeNumber(product.stockCurrent),
        stockIdeal: normalizeNumber(product.stockIdeal),
        status: product.status === "inactive" ? "inactive" : "active",
        createdAt: product.createdAt || new Date().toISOString(),
      }))
    : [];

  const collaborators = Array.isArray(source.collaborators)
    ? source.collaborators.map((collaborator) => ({
        id: collaborator.id || createId("collaborator"),
        name: String(collaborator.name || "").trim(),
        area: normalizeCollaboratorRole(collaborator.area),
        branch: normalizeCollaboratorBranch(collaborator.branch),
        password: String(collaborator.password || ""),
        status: collaborator.status === "inactive" ? "inactive" : "active",
        createdAt: collaborator.createdAt || new Date().toISOString(),
      }))
    : [];

  const validProductIds = new Set(products.map((product) => product.id));
  const validCollaboratorIds = new Set(collaborators.map((collaborator) => collaborator.id));

  const assignments = Array.isArray(source.assignments)
    ? source.assignments
        .map((assignment) => ({
          id: assignment.id || createId("assignment"),
          collaboratorId: assignment.collaboratorId,
          productId: assignment.productId,
          targetQuantity: normalizeNumber(assignment.targetQuantity),
          note: String(assignment.note || "").trim(),
          createdAt: assignment.createdAt || new Date().toISOString(),
        }))
        .filter(
          (assignment) =>
            validProductIds.has(assignment.productId) &&
            validCollaboratorIds.has(assignment.collaboratorId),
        )
    : [];

  const history = Array.isArray(source.history)
    ? source.history.map((record) => ({
        id: record.id || createId("history"),
        type: record.type === "salida" ? "salida" : "entrada",
        date: record.date || today(),
        createdAt: record.createdAt || new Date().toISOString(),
        productId: record.productId || "",
        productName: String(record.productName || "").trim(),
        quantity: normalizeNumber(record.quantity),
        unit: String(record.unit || "").trim(),
        collaboratorId: record.collaboratorId || "",
        collaboratorName: String(record.collaboratorName || "").trim(),
        destination: String(record.destination || "").trim(),
        observation: String(record.observation || "").trim(),
        stockAfter: normalizeNumber(record.stockAfter),
        stockIdeal: normalizeNumber(record.stockIdeal),
        notificationId: record.notificationId || "",
        notificationMessage: String(record.notificationMessage || "").trim(),
      }))
    : [];

  const notifications = Array.isArray(source.notifications)
    ? source.notifications.map((notification) => ({
        id: notification.id || createId("notification"),
        productId: notification.productId || "",
        productName: String(notification.productName || "").trim(),
        quantity: normalizeNumber(notification.quantity),
        unit: String(notification.unit || "").trim(),
        message: String(notification.message || "").trim(),
        date: notification.date || today(),
        createdAt: notification.createdAt || new Date().toISOString(),
        destination: String(notification.destination || "").trim(),
        collaboratorNames: Array.isArray(notification.collaboratorNames)
          ? notification.collaboratorNames.map((name) => String(name).trim()).filter(Boolean)
          : [],
        status: normalizeNotificationStatus(notification.status),
        taskRequired:
          typeof notification.taskRequired === "boolean"
            ? notification.taskRequired
            : !String(notification.message || "")
                .toLowerCase()
                .includes("inventario sigue abastecido"),
        completedAt:
          notification.completedAt && !Number.isNaN(new Date(notification.completedAt).getTime())
            ? notification.completedAt
            : "",
        sourceHistoryId: notification.sourceHistoryId || "",
        sourceOrderId: String(notification.sourceOrderId || "").trim(),
        sourceType: normalizeNotificationSourceType(notification.sourceType, notification),
        branchId: String(notification.branchId || ""),
        brandName: normalizeBranchBrand(notification.brandName),
      }))
    : [];

  const branchNeedsSource = Array.isArray(source.branchNeeds) ? source.branchNeeds : [];
  const branchNeedsByKey = new Map();
  branchNeedsSource.forEach((branchNeed) => {
    const branchId = String(branchNeed.branchId || branchNeed.id || "");
    const brandName = normalizeBranchBrand(branchNeed.brandName) || BRANCH_BRANDS[0];
    const key = createBranchNeedKey(branchId, brandName);
    const current = branchNeedsByKey.get(key) || {
      branchId,
      brandName,
      productIds: [],
      stockByProductId: {},
      updatedAt: "",
    };

    const nextProductIds = Array.isArray(branchNeed.productIds)
      ? branchNeed.productIds.map((id) => String(id || "")).filter((id) => validProductIds.has(id))
      : [];
    const nextStockMap =
      branchNeed && typeof branchNeed.stockByProductId === "object" && branchNeed.stockByProductId
        ? Object.entries(branchNeed.stockByProductId).reduce((stockMap, [productId, stockValue]) => {
            const normalizedProductId = String(productId || "");
            if (!validProductIds.has(normalizedProductId)) {
              return stockMap;
            }

            stockMap[normalizedProductId] = normalizeNumber(stockValue, 0);
            return stockMap;
          }, {})
        : {};

    current.productIds = [...new Set([...current.productIds, ...nextProductIds])];
    current.stockByProductId = {
      ...(current.stockByProductId || {}),
      ...nextStockMap,
    };
    current.updatedAt =
      branchNeed.updatedAt && !Number.isNaN(new Date(branchNeed.updatedAt).getTime())
        ? branchNeed.updatedAt
        : current.updatedAt;

    branchNeedsByKey.set(key, current);
  });

  const branchNeeds = BRANCH_LOCATIONS.flatMap((branch) =>
    BRANCH_BRANDS.map((brandName) => {
      const key = createBranchNeedKey(branch.id, brandName);
      const rawBranchNeed = branchNeedsByKey.get(key) || {};

      return {
        branchId: branch.id,
        brandName,
        productIds: Array.isArray(rawBranchNeed.productIds) ? rawBranchNeed.productIds : [],
        stockByProductId:
          Array.isArray(source.branchConsumption) &&
          rawBranchNeed &&
          typeof rawBranchNeed.stockByProductId === "object" &&
          rawBranchNeed.stockByProductId
            ? rawBranchNeed.stockByProductId
            : {},
        updatedAt:
          rawBranchNeed.updatedAt && !Number.isNaN(new Date(rawBranchNeed.updatedAt).getTime())
            ? rawBranchNeed.updatedAt
            : "",
      };
    }),
  );

  const branchCatalogSource = Array.isArray(source.branchCatalogs)
    ? source.branchCatalogs
    : [...branchNeedsByKey.values()];
  const branchCatalogsByKey = new Map();
  branchCatalogSource.forEach((branchCatalog) => {
    const branchId = String(branchCatalog.branchId || branchCatalog.id || "");
    if (!getBranchLocationById(branchId)) {
      return;
    }

    const brandName = normalizeBranchBrand(branchCatalog.brandName) || BRANCH_BRANDS[0];
    const key = createBranchNeedKey(branchId, brandName);
    const current = branchCatalogsByKey.get(key) || {
      branchId,
      brandName,
      productIds: [],
      updatedAt: "",
    };

    const explicitProductIds = Array.isArray(branchCatalog.productIds)
      ? branchCatalog.productIds
          .map((productId) => String(productId || ""))
          .filter((productId) => validProductIds.has(productId))
      : [];
    const legacyVisibleProductIds =
      branchCatalog && typeof branchCatalog.stockByProductId === "object" && branchCatalog.stockByProductId
        ? Object.keys(branchCatalog.stockByProductId)
            .map((productId) => String(productId || ""))
            .filter((productId) => validProductIds.has(productId))
        : [];

    current.productIds = [
      ...new Set([...current.productIds, ...explicitProductIds, ...legacyVisibleProductIds]),
    ];
    current.updatedAt =
      branchCatalog.updatedAt && !Number.isNaN(new Date(branchCatalog.updatedAt).getTime())
        ? branchCatalog.updatedAt
        : current.updatedAt;

    branchCatalogsByKey.set(key, current);
  });

  const branchCatalogs = BRANCH_LOCATIONS.flatMap((branch) =>
    BRANCH_BRANDS.map((brandName) => {
      const key = createBranchNeedKey(branch.id, brandName);
      const rawBranchCatalog = branchCatalogsByKey.get(key) || {};

      return {
        branchId: branch.id,
        brandName,
        productIds: Array.isArray(rawBranchCatalog.productIds) ? rawBranchCatalog.productIds : [],
        updatedAt:
          rawBranchCatalog.updatedAt && !Number.isNaN(new Date(rawBranchCatalog.updatedAt).getTime())
            ? rawBranchCatalog.updatedAt
            : "",
      };
    }),
  );

  const legacyBranchStorageById = new Map();
  [...branchNeedsByKey.values()]
    .sort(
      (left, right) =>
        new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime(),
    )
    .forEach((branchNeed) => {
      if (!getBranchLocationById(branchNeed.branchId)) {
        return;
      }

      const current = legacyBranchStorageById.get(branchNeed.branchId) || {
        branchId: branchNeed.branchId,
        stockByProductId: {},
        updatedAt: "",
      };

      current.stockByProductId = {
        ...(current.stockByProductId || {}),
        ...sanitizeBranchStockMap(branchNeed.stockByProductId, validProductIds),
      };
      current.updatedAt =
        branchNeed.updatedAt && !Number.isNaN(new Date(branchNeed.updatedAt).getTime())
          ? branchNeed.updatedAt
          : current.updatedAt;

      legacyBranchStorageById.set(branchNeed.branchId, current);
    });

  const branchStorageSource = Array.isArray(source.branchStorage) ? source.branchStorage : [];
  const branchConsumptionSource = Array.isArray(source.branchConsumption)
    ? source.branchConsumption
    : branchStorageSource.length > 0
      ? branchStorageSource
      : [...legacyBranchStorageById.values()];
  const branchConsumptionById = new Map();
  branchConsumptionSource.forEach((branchConsumption) => {
    const branchId = String(branchConsumption.branchId || branchConsumption.id || "");
    if (!getBranchLocationById(branchId)) {
      return;
    }

    const current = branchConsumptionById.get(branchId) || {
      branchId,
      consumptionByProductId: {},
      updatedAt: "",
    };

    current.consumptionByProductId = {
      ...(current.consumptionByProductId || {}),
      ...sanitizeBranchStockMap(
        branchConsumption.consumptionByProductId || branchConsumption.stockByProductId,
        validProductIds,
      ),
    };
    current.updatedAt =
      branchConsumption.updatedAt && !Number.isNaN(new Date(branchConsumption.updatedAt).getTime())
        ? branchConsumption.updatedAt
        : current.updatedAt;

    branchConsumptionById.set(branchId, current);
  });

  const branchConsumption = BRANCH_LOCATIONS.map((branch) => {
    const rawBranchConsumption = branchConsumptionById.get(branch.id) || {};
    return {
      branchId: branch.id,
      consumptionByProductId:
        rawBranchConsumption &&
        typeof rawBranchConsumption.consumptionByProductId === "object" &&
        rawBranchConsumption.consumptionByProductId
          ? rawBranchConsumption.consumptionByProductId
          : {},
      updatedAt:
        rawBranchConsumption.updatedAt &&
        !Number.isNaN(new Date(rawBranchConsumption.updatedAt).getTime())
          ? rawBranchConsumption.updatedAt
          : "",
    };
  });

  const branchDailyQuantitySource = Array.isArray(source.branchDailyQuantities)
    ? source.branchDailyQuantities
    : [];
  const branchDailyQuantityById = new Map();
  branchDailyQuantitySource.forEach((branchDailyQuantity) => {
    const branchId = String(branchDailyQuantity.branchId || branchDailyQuantity.id || "");
    if (!getBranchLocationById(branchId)) {
      return;
    }

    const current = branchDailyQuantityById.get(branchId) || {
      branchId,
      dailyQuantityByProductId: {},
      updatedAt: "",
    };

    current.dailyQuantityByProductId = {
      ...(current.dailyQuantityByProductId || {}),
      ...sanitizeBranchStockMap(
        branchDailyQuantity.dailyQuantityByProductId || branchDailyQuantity.quantityByProductId,
        validProductIds,
      ),
    };
    current.updatedAt =
      branchDailyQuantity.updatedAt &&
      !Number.isNaN(new Date(branchDailyQuantity.updatedAt).getTime())
        ? branchDailyQuantity.updatedAt
        : current.updatedAt;

    branchDailyQuantityById.set(branchId, current);
  });

  const branchDailyQuantities = BRANCH_LOCATIONS.map((branch) => {
    const rawBranchDailyQuantity = branchDailyQuantityById.get(branch.id) || {};
    return {
      branchId: branch.id,
      dailyQuantityByProductId:
        rawBranchDailyQuantity &&
        typeof rawBranchDailyQuantity.dailyQuantityByProductId === "object" &&
        rawBranchDailyQuantity.dailyQuantityByProductId
          ? rawBranchDailyQuantity.dailyQuantityByProductId
          : {},
      updatedAt:
        rawBranchDailyQuantity.updatedAt &&
        !Number.isNaN(new Date(rawBranchDailyQuantity.updatedAt).getTime())
          ? rawBranchDailyQuantity.updatedAt
          : "",
    };
  });

  const branchStorageById = new Map();
  if (Array.isArray(source.branchConsumption)) {
    branchStorageSource.forEach((branchStorage) => {
      const branchId = String(branchStorage.branchId || branchStorage.id || "");
      if (!getBranchLocationById(branchId)) {
        return;
      }

      const current = branchStorageById.get(branchId) || {
        branchId,
        stockByProductId: {},
        updatedAt: "",
      };

      const sanitizedBranchStockMap = sanitizeBranchStockMap(
        branchStorage.stockByProductId,
        validProductIds,
      );
      const nextStockMap = Object.entries(sanitizedBranchStockMap).reduce(
        (stockMap, [productId, stockValue]) => {
          const hasExplicitStoreStock = [...branchNeedsByKey.values()].some(
            (branchNeed) =>
              branchNeed.branchId === branchId &&
              Object.prototype.hasOwnProperty.call(branchNeed.stockByProductId || {}, productId),
          );
          const branchConsumptionValue = branchConsumptionById.get(branchId)?.consumptionByProductId?.[
            productId
          ];
          const isLegacyConsumptionMirror =
            !hasExplicitStoreStock &&
            typeof branchConsumptionValue === "number" &&
            roundStock(branchConsumptionValue) === roundStock(normalizeNumber(stockValue, 0));

          if (isLegacyConsumptionMirror) {
            return stockMap;
          }

          stockMap[productId] = normalizeNumber(stockValue, 0);
          return stockMap;
        },
        {},
      );

      current.stockByProductId = {
        ...(current.stockByProductId || {}),
        ...nextStockMap,
      };
      current.updatedAt =
        branchStorage.updatedAt && !Number.isNaN(new Date(branchStorage.updatedAt).getTime())
          ? branchStorage.updatedAt
          : current.updatedAt;

      branchStorageById.set(branchId, current);
    });
  }

  const branchStorage = BRANCH_LOCATIONS.map((branch) => {
    const rawBranchStorage = branchStorageById.get(branch.id) || {};
    return {
      branchId: branch.id,
      stockByProductId:
        rawBranchStorage &&
        typeof rawBranchStorage.stockByProductId === "object" &&
        rawBranchStorage.stockByProductId
          ? rawBranchStorage.stockByProductId
          : {},
      updatedAt:
        rawBranchStorage.updatedAt && !Number.isNaN(new Date(rawBranchStorage.updatedAt).getTime())
          ? rawBranchStorage.updatedAt
          : "",
    };
  });

  const kitchenOrders = Array.isArray(source.kitchenOrders)
    ? source.kitchenOrders
        .map((order) => {
          const branch = getBranchLocationById(String(order.branchId || ""));
          const branchName = branch?.name || String(order.branchName || "").trim();
          const brandName = normalizeBranchBrand(order.brandName);
          const items = Array.isArray(order.items)
            ? order.items
                .map((item) => {
                  const requested = roundStock(normalizeNumber(item.requested, 0));
                  const delivered = roundStock(normalizeNumber(item.delivered, 0));
                  const pending = roundStock(
                    normalizeNumber(item.pending, Math.max(requested - delivered, 0)),
                  );

                  if (!String(item.productName || "").trim() || requested <= 0) {
                    return null;
                  }

                  return {
                    productId: String(item.productId || ""),
                    productName: String(item.productName || "").trim(),
                    unit: String(item.unit || "").trim(),
                    requested,
                    delivered,
                    pending: pending >= 0 ? pending : Math.max(requested - delivered, 0),
                    workedInKitchen: item.workedInKitchen === true,
                    workedAt:
                      item.workedAt && !Number.isNaN(new Date(item.workedAt).getTime())
                        ? item.workedAt
                        : "",
                  };
                })
                .filter(Boolean)
            : [];

          if (!branchName || !brandName || items.length === 0) {
            return null;
          }

          return {
            id: order.id || createId("kitchen-order"),
            number: String(order.number || createKitchenOrderNumber()).trim(),
            branchId: branch?.id || "",
            branchName,
            brandName,
            requesterId: String(order.requesterId || ""),
            requesterName: String(order.requesterName || "").trim(),
            requesterRole: normalizeCollaboratorRole(order.requesterRole),
            authorizedById: String(order.authorizedById || ""),
            authorizedByName: String(order.authorizedByName || "").trim(),
            authorizedByRole: normalizeCollaboratorRole(order.authorizedByRole),
            origin: String(order.origin || "Cuarto Frio").trim(),
            destination:
              String(order.destination || `${branchName} / ${brandName}`).trim() ||
              `${branchName} / ${brandName}`,
            status: String(order.status || "pendiente").trim() || "pendiente",
            date: order.date || today(),
            createdAt: order.createdAt || new Date().toISOString(),
            forwardedToDispatch: order.forwardedToDispatch === true,
            forwardedAt:
              order.forwardedAt && !Number.isNaN(new Date(order.forwardedAt).getTime())
                ? order.forwardedAt
                : "",
            forwardedById: String(order.forwardedById || ""),
            forwardedByName: String(order.forwardedByName || "").trim(),
            forwardedByRole: normalizeCollaboratorRole(order.forwardedByRole),
            sentToKitchen: order.sentToKitchen === true,
            sentToKitchenAt:
              order.sentToKitchenAt && !Number.isNaN(new Date(order.sentToKitchenAt).getTime())
                ? order.sentToKitchenAt
                : "",
            sentToKitchenById: String(order.sentToKitchenById || ""),
            sentToKitchenByName: String(order.sentToKitchenByName || "").trim(),
            sentToKitchenByRole: normalizeCollaboratorRole(order.sentToKitchenByRole),
            items,
          };
        })
        .filter(Boolean)
    : [];

  return {
    products,
    collaborators,
    assignments,
    history,
    notifications,
    branchNeeds,
    branchCatalogs,
    branchStorage,
    branchConsumption,
    branchDailyQuantities,
    kitchenOrders,
  };
}

async function initializeCloudSync({ retrying = false } = {}) {
  if (cloudSync.retryTimerId) {
    clearTimeout(cloudSync.retryTimerId);
    cloudSync.retryTimerId = null;
  }

  if (retrying && typeof cloudSync.unsubscribe === "function") {
    cloudSync.unsubscribe();
    cloudSync.unsubscribe = null;
  }

  cloudSync.enabled = true;
  cloudSync.status = "connecting";
  cloudSync.statusMessage = retrying
    ? "Reconectando sincronización en vivo..."
    : "Conectando sincronización en vivo...";
  render();

  try {
    const remoteSnapshot = await getDoc(cloudStateRef);

    if (remoteSnapshot.exists()) {
      applyRemoteState(remoteSnapshot.data()?.state);
    } else {
      await pushStateToCloud(true);
    }

    cloudSync.initialized = true;
    cloudSync.enabled = true;
    cloudSync.retryCount = 0;
    cloudSync.status = "online";
    cloudSync.statusMessage = "Sincronización en vivo activa.";

    cloudSync.unsubscribe = onSnapshot(
      cloudStateRef,
      (snapshot) => {
        const syncWasOnline = cloudSync.status === "online";

        if (!snapshot.exists()) {
          return;
        }

        cloudSync.enabled = true;
        cloudSync.initialized = true;
        cloudSync.retryCount = 0;
        cloudSync.status = "online";
        cloudSync.statusMessage = "Sincronización en vivo activa.";
        const didApplyRemoteState = applyRemoteState(snapshot.data()?.state);

        if (!didApplyRemoteState && !syncWasOnline) {
          render();
        }
      },
      (error) => {
        console.error("Firestore sync listener error:", error);
        handleCloudSyncFailure(error);
      },
    );

    render();
  } catch (error) {
    console.error("Firestore initial sync error:", error);
    handleCloudSyncFailure(error);
  }
}

async function initializePresenceSync() {
  if (!presenceSync.heartbeatTimerId) {
    presenceSync.heartbeatTimerId = window.setInterval(() => {
      void pushPresenceHeartbeat();
    }, PRESENCE_HEARTBEAT_MS);
  }

  if (!presenceSync.expiryTimerId) {
    presenceSync.expiryTimerId = window.setInterval(() => {
      refreshPresenceRenderState();
    }, 5000);
  }

  if (typeof presenceSync.unsubscribe !== "function") {
    presenceSync.unsubscribe = onSnapshot(
      presenceCollectionRef,
      (snapshot) => {
        presenceSync.records = snapshot.docs
          .map((recordSnapshot) => sanitizePresenceRecord(recordSnapshot.id, recordSnapshot.data()))
          .filter(Boolean);
        refreshPresenceRenderState();
      },
      (error) => {
        console.error("Firestore presence listener error:", error);
      },
    );
  }

  await pushPresenceHeartbeat(true);
}

function handleCloudSyncFailure(error) {
  cloudSync.enabled = false;
  cloudSync.initialized = false;
  cloudSync.status = "error";
  cloudSync.statusMessage =
    "Esta sesión quedó en modo local. Reintentando sincronización automáticamente.";
  scheduleCloudSyncRetry(error);
  render();
}

function sanitizePresenceRecord(id, rawRecord) {
  if (!id || !rawRecord || typeof rawRecord !== "object") {
    return null;
  }

  return {
    sessionId: id,
    collaboratorId: String(rawRecord.collaboratorId || ""),
    name: String(rawRecord.name || "").trim(),
    role: normalizeCollaboratorRole(rawRecord.role),
    module: String(rawRecord.module || "").trim(),
    lastSeen: String(rawRecord.lastSeen || ""),
  };
}

function scheduleCloudSyncRetry(error) {
  if (cloudSync.retryTimerId) {
    return;
  }

  cloudSync.retryCount += 1;
  const delay = Math.min(4000 * cloudSync.retryCount, 30000);

  if (error) {
    console.error(
      `Firestore reconnect scheduled in ${delay}ms (attempt ${cloudSync.retryCount}).`,
      error,
    );
  }

  cloudSync.retryTimerId = setTimeout(() => {
    cloudSync.retryTimerId = null;
    void initializeCloudSync({ retrying: true });
  }, delay);
}

function applyRemoteState(remoteState) {
  const sanitizedRemoteState = sanitizeState(remoteState);
  const remoteSignature = JSON.stringify(sanitizedRemoteState);
  const currentSignature = JSON.stringify(state);

  if (remoteSignature === currentSignature || remoteSignature === cloudSync.lastSnapshotSignature) {
    cloudSync.lastSnapshotSignature = remoteSignature;
    return false;
  }

  cloudSync.applyingRemoteState = true;
  cloudSync.lastSnapshotSignature = remoteSignature;
  state = sanitizedRemoteState;
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  cloudSync.applyingRemoteState = false;
  render();
  return true;
}

function saveState() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  queueCloudStateSave();
}

function saveSession() {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function queueCloudStateSave() {
  if (!cloudSync.enabled || !cloudSync.initialized || cloudSync.applyingRemoteState) {
    return;
  }

  if (cloudSync.writeTimerId) {
    clearTimeout(cloudSync.writeTimerId);
  }

  cloudSync.writeTimerId = setTimeout(() => {
    void pushStateToCloud();
  }, 180);
}

async function pushStateToCloud(force = false) {
  if (!cloudSync.enabled || (!force && !cloudSync.initialized) || cloudSync.applyingRemoteState) {
    return;
  }

  const stateToPersist = sanitizeState(state);
  const stateSignature = JSON.stringify(stateToPersist);

  if (stateSignature === cloudSync.lastSnapshotSignature) {
    return;
  }

  try {
    await setDoc(cloudStateRef, {
      state: stateToPersist,
      updatedAt: new Date().toISOString(),
    });
    cloudSync.lastSnapshotSignature = stateSignature;
    cloudSync.enabled = true;
    cloudSync.initialized = true;
    cloudSync.retryCount = 0;
    cloudSync.status = "online";
    cloudSync.statusMessage = "Sincronización en vivo activa.";
  } catch (error) {
    console.error("Firestore save error:", error);
    handleCloudSyncFailure(error);
  }
}

function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();

  switch (form.id) {
    case "login-form":
      submitLogin(form);
      return;
    case "cold-room-access-form":
      submitColdRoomAccess(form);
      return;
    case "orders-access-form":
      submitOrdersAccess(form);
      return;
    case "history-delete-form":
      submitHistoryDelete(form);
      return;
    case "kitchen-order-auth-form":
      submitKitchenOrderAuthorization(form);
      return;
    case "collaborator-form":
      submitCollaborator(form);
      return;
    case "assignment-form":
      if (!validateAssignmentCollaboratorSelection(form)) {
        return;
      }
      submitAssignment(form);
      return;
    case "product-form":
      submitProduct(form);
      return;
    case "product-search-form":
      ui.productSearch = String(new FormData(form).get("productSearch") || "").trim();
      render();
      return;
    case "entry-form":
      submitEntry(form);
      return;
    case "exit-form":
      submitExit(form);
      return;
    case "history-filter-form":
      ui.historySearch = String(new FormData(form).get("historySearch") || "").trim();
      ui.historyDate = String(new FormData(form).get("historyDate") || "");
      render();
      return;
    default:
      return;
  }
}

function handleClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  // Prevenir comportamiento por defecto para botones
  if (trigger.tagName === "BUTTON") {
    event.preventDefault();
  }

  const action = trigger.dataset.action;

  // Debug para todos los clicks en botones con data-action
  console.log("Button clicked:", action, trigger.dataset.id);

  switch (action) {
    case "logout":
      session.authenticated = false;
      session.activeCollaboratorId = "";
      session.loginRole = "";
      session.loginCollaboratorId = "";
      clearColdRoomAuthorization();
      clearOrdersAuthorization();
      saveSession();
      ui.currentModule = "home";
      ui.coldRoomSection = "equipo";
      ui.kitchenSection = "panel";
      ui.selectedBranchId = "";
      ui.selectedBranchBrand = "";
      ui.selectedKitchenBranchId = "";
      ui.selectedKitchenBrand = "";
      ui.kitchenOrderPrompt = false;
      ui.kitchenOrderPromptBranchId = "";
      ui.kitchenOrderPromptBrandName = "";
      ui.coldRoomAccessPrompt = false;
      ui.ordersAccessPrompt = false;
      ui.historyDeletePrompt = false;
      ui.historyDeleteSource = "";
      ui.techPanelPrompt = false;
      ui.collaboratorPasswordPrompt = false;
      ui.collaboratorPasswordCollaboratorId = "";
      resetProductWorkflowState();
      clearBranchDrafts();
      clearExitDraft();
      ui.flash = null;
      render();
      return;
    case "go-home":
      ui.currentModule = "home";
      ui.selectedBranchId = "";
      ui.selectedBranchBrand = "";
      ui.selectedKitchenBranchId = "";
      ui.selectedKitchenBrand = "";
      ui.kitchenOrderPrompt = false;
      ui.kitchenOrderPromptBranchId = "";
      ui.kitchenOrderPromptBrandName = "";
      ui.coldRoomAccessPrompt = false;
      ui.ordersAccessPrompt = false;
      ui.historyDeletePrompt = false;
      ui.techPanelPrompt = false;
      ui.collaboratorPasswordPrompt = false;
      ui.collaboratorPasswordCollaboratorId = "";
      resetProductWorkflowState();
      ui.flash = null;
      render();
      return;
    case "open-module":
      if (trigger.dataset.module === "kitchen") {
        if (!canAccessKitchenModule()) {
          ui.currentModule = "home";
          setFlash("session", "info", getOperatorAccessMessage("kitchen"));
          render();
          return;
        }

        ui.currentModule = "kitchen";
        ui.kitchenSection = "panel";
        ui.selectedKitchenBranchId = "";
        ui.selectedKitchenBrand = "";
        ui.coldRoomAccessPrompt = false;
        ui.ordersAccessPrompt = false;
      } else if (trigger.dataset.module === "orders") {
        if (!canAccessOrdersModule()) {
          ui.currentModule = canAccessKitchenModule() ? "kitchen" : "home";
          ui.ordersAccessPrompt = false;
          ui.coldRoomAccessPrompt = false;
          setFlash("session", "error", getOperatorAccessMessage("orders"));
          render();
          return;
        }

        ui.currentModule = "orders";
        ui.selectedBranchId = "";
        ui.selectedBranchBrand = "";
        ui.selectedBranchStorage = false;
        clearBranchDrafts();
        ui.coldRoomAccessPrompt = false;
        ui.ordersAccessPrompt = false;
      } else if (trigger.dataset.module === "branches") {
        if (!canAccessBranchesModule()) {
          ui.currentModule = canAccessKitchenModule() ? "kitchen" : "home";
          setFlash("session", "error", getOperatorAccessMessage("branches"));
          render();
          return;
        }

        ui.currentModule = "branches";
        ui.selectedBranchId = "";
        ui.selectedBranchBrand = "";
        ui.selectedBranchStorage = false;
        clearBranchDrafts();
        ui.coldRoomAccessPrompt = false;
        ui.ordersAccessPrompt = false;
      } else {
        if (!canAccessColdRoomModule()) {
          ui.currentModule = "home";
          ui.coldRoomAccessPrompt = true;
          ui.ordersAccessPrompt = false;
          ui.flash = null;
          render();
          return;
        }

        ui.currentModule = "cold-room";
        ui.coldRoomAccessPrompt = false;
        ui.ordersAccessPrompt = false;
      }
      if (ui.currentModule === "cold-room" && !ui.coldRoomSection) {
        ui.coldRoomSection = "equipo";
      }
      ui.flash = null;
      render();
      return;
    case "set-kitchen-section":
      ui.currentModule = "kitchen";
      ui.kitchenSection = trigger.dataset.section === "products" ? "products" : "panel";
      if (ui.kitchenSection === "panel") {
        ui.selectedKitchenBranchId = "";
        ui.selectedKitchenBrand = "";
      }
      ui.flash = null;
      render();
      return;
    case "open-kitchen-branch":
      if (!canAccessKitchenBranch(String(trigger.dataset.branchId || ""))) {
        ui.currentModule = "kitchen";
        ui.kitchenSection = "products";
        ui.selectedKitchenBranchId = "";
        ui.selectedKitchenBrand = "";
        clearBranchDrafts();
        setFlash("branches", "error", "Solo puedes acceder a la sucursal asignada a tu perfil de Cocina.");
        render();
        return;
      }
      ui.currentModule = "kitchen";
      ui.kitchenSection = "products";
      ui.selectedKitchenBranchId = String(trigger.dataset.branchId || "");
      ui.selectedKitchenBrand = "";
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "open-kitchen-brand":
      if (!canAccessKitchenBranch(String(trigger.dataset.branchId || ""))) {
        ui.currentModule = "kitchen";
        ui.kitchenSection = "products";
        ui.selectedKitchenBranchId = "";
        ui.selectedKitchenBrand = "";
        clearBranchDrafts();
        setFlash("branches", "error", "Solo puedes acceder a la sucursal asignada a tu perfil de Cocina.");
        render();
        return;
      }
      ui.currentModule = "kitchen";
      ui.kitchenSection = "products";
      ui.selectedKitchenBranchId = String(trigger.dataset.branchId || "");
      ui.selectedKitchenBrand = normalizeBranchBrand(trigger.dataset.brandName || "");
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "back-to-kitchen-branches":
      ui.currentModule = "kitchen";
      ui.kitchenSection = "products";
      ui.selectedKitchenBranchId = "";
      ui.selectedKitchenBrand = "";
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "back-to-kitchen-brands":
      ui.currentModule = "kitchen";
      ui.kitchenSection = "products";
      ui.selectedKitchenBrand = "";
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "request-kitchen-order":
      requestKitchenOrder(
        String(trigger.dataset.branchId || ""),
        String(trigger.dataset.brandName || ""),
      );
      return;
    case "cancel-kitchen-order-auth":
      closeKitchenOrderPrompt();
      ui.flash = null;
      render();
      return;
    case "print-kitchen-order":
      printKitchenOrder(String(trigger.dataset.id || ""));
      return;
    case "delete-kitchen-order":
      console.log("Delete kitchen order clicked:", String(trigger.dataset.id || ""));
      deleteKitchenOrder(String(trigger.dataset.id || ""));
      return;
    case "forward-kitchen-order":
      forwardKitchenOrderToDispatch(String(trigger.dataset.id || ""));
      return;
    case "view-order":
      viewOrderModal(String(trigger.dataset.id || ""));
      return;
    case "send-to-branch":
      sendOrderToBranch(String(trigger.dataset.id || ""));
      return;
    case "mark-unavailable":
      markProductAsUnavailable(
        String(trigger.dataset.orderId || ""),
        String(trigger.dataset.productId || ""),
        String(trigger.dataset.productName || "")
      );
      return;
    case "set-orders-tab":
      ui.ordersTab = String(trigger.dataset.tab || "activos");
      render();
      return;
    case "close-modal":
      const modal = trigger.closest(".modal-overlay");
      if (modal) {
        modal.remove();
      }
      return;
    case "dispatch-kitchen-order":
      dispatchKitchenOrder(String(trigger.dataset.id || ""));
      return;
    case "dispatch-branch-notification":
      dispatchBranchNotification(String(trigger.dataset.id || ""));
      return;
    case "open-branch":
      if (!canAccessBranch(String(trigger.dataset.branchId || ""))) {
        ui.currentModule = "branches";
        ui.selectedBranchId = "";
        ui.selectedBranchBrand = "";
        ui.selectedBranchStorage = false;
        clearBranchDrafts();
        setFlash("branches", "error", "Solo puedes acceder a la sucursal asignada a tu turno.");
        render();
        return;
      }
      ui.currentModule = "branches";
      ui.selectedBranchId = String(trigger.dataset.branchId || "");
      ui.selectedBranchBrand = "";
      ui.selectedBranchStorage = false;
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "open-branch-brand":
      if (!canAccessBranch(String(trigger.dataset.branchId || ""))) {
        ui.currentModule = "branches";
        ui.selectedBranchId = "";
        ui.selectedBranchBrand = "";
        ui.selectedBranchStorage = false;
        clearBranchDrafts();
        setFlash("branches", "error", "Solo puedes acceder a la sucursal asignada a tu turno.");
        render();
        return;
      }
      ui.currentModule = "branches";
      ui.selectedBranchId = String(trigger.dataset.branchId || "");
      ui.selectedBranchBrand = normalizeBranchBrand(trigger.dataset.brandName || "");
      ui.selectedBranchStorage = false;
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "open-branch-storage":
      if (!canAccessBranch(String(trigger.dataset.branchId || ""))) {
        ui.currentModule = "branches";
        ui.selectedBranchId = "";
        ui.selectedBranchBrand = "";
        ui.selectedBranchStorage = false;
        clearBranchDrafts();
        setFlash("branches", "error", "Solo puedes acceder a la sucursal asignada a tu turno.");
        render();
        return;
      }
      ui.currentModule = "branches";
      ui.selectedBranchId = String(trigger.dataset.branchId || "");
      ui.selectedBranchBrand = "";
      ui.selectedBranchStorage = true;
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "toggle-branch-storage-brand":
      toggleBranchCatalogProduct(
        String(trigger.dataset.branchId || ""),
        String(trigger.dataset.brandName || ""),
        String(trigger.dataset.productId || ""),
      );
      return;
    case "back-to-branches":
      ui.selectedBranchId = "";
      ui.selectedBranchBrand = "";
      ui.selectedBranchStorage = false;
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "back-to-branch-brands":
      ui.selectedBranchBrand = "";
      ui.selectedBranchStorage = false;
      clearBranchDrafts();
      ui.flash = null;
      render();
      return;
    case "cancel-cold-room-access":
      ui.coldRoomAccessPrompt = false;
      ui.flash = null;
      render();
      return;
    case "cancel-orders-access":
      ui.ordersAccessPrompt = false;
      ui.flash = null;
      render();
      return;
    case "open-history-delete":
      ui.historyDeletePrompt = true;
      ui.historyDeleteSource = String(trigger.dataset.source || "");
      ui.flash = null;
      render();
      return;
    case "cancel-history-delete":
      ui.historyDeletePrompt = false;
      ui.historyDeleteSource = "";
      ui.flash = null;
      render();
      return;
    case "open-collaborator-password":
      ui.collaboratorPasswordPrompt = true;
      ui.collaboratorPasswordCollaboratorId = String(trigger.dataset.id || "");
      ui.flash = null;
      render();
      return;
    case "cancel-collaborator-password":
      ui.collaboratorPasswordPrompt = false;
      ui.collaboratorPasswordCollaboratorId = "";
      ui.flash = null;
      render();
      return;
    case "confirm-product-production":
      confirmProductProduction();
      return;
    case "cancel-product-production":
      closeProductProductionPrompt();
      ui.flash = null;
      render();
      return;
    case "set-cold-section":
      if (!canAccessColdRoomModule()) {
        ui.currentModule = canAccessKitchenModule() ? "kitchen" : "home";
        setFlash("session", "error", getOperatorAccessMessage("cold-room"));
        render();
        return;
      }
      ui.coldRoomSection = trigger.dataset.section || "equipo";
      if (ui.coldRoomSection !== "productos") {
        ui.productMatchId = "";
        closeProductProductionPrompt();
      }
      ui.flash = null;
      render();
      return;
    case "edit-collaborator":
      ui.editingCollaboratorId = trigger.dataset.id || null;
      ui.flash = null;
      render();
      return;
    case "cancel-collaborator-edit":
      ui.editingCollaboratorId = null;
      ui.flash = null;
      render();
      return;
    case "delete-collaborator":
      deleteCollaborator(trigger.dataset.id || "");
      return;
    case "delete-assignment":
      deleteAssignment(trigger.dataset.id || "");
      return;
    case "edit-product":
      if (ui.currentModule === "kitchen" && ui.kitchenSection === "products" && !canManageKitchenProductCatalog()) {
        setFlash("products", "error", "Desde Cocina solo puedes consultar este inventario. Para editar necesitas acceso autorizado a Cuarto Frio.");
        render();
        return;
      }
      if (ui.currentModule === "kitchen" && ui.kitchenSection === "products" && canManageKitchenProductCatalog()) {
        ui.currentModule = "cold-room";
        ui.coldRoomSection = "productos";
      }
      ui.editingProductId = trigger.dataset.id || null;
      ui.productMatchId = "";
      closeProductProductionPrompt();
      ui.flash = null;
      render();
      return;
    case "cancel-product-edit":
      ui.editingProductId = null;
      ui.productMatchId = "";
      closeProductProductionPrompt();
      ui.flash = null;
      render();
      return;
    case "delete-product":
      if (ui.currentModule === "kitchen" && ui.kitchenSection === "products" && !canManageKitchenProductCatalog()) {
        setFlash("products", "error", "Desde Cocina solo puedes consultar este inventario. Para eliminar necesitas acceso autorizado a Cuarto Frio.");
        render();
        return;
      }
      deleteProduct(trigger.dataset.id || "");
      return;
    case "clear-product-search":
      ui.productSearch = "";
      ui.flash = null;
      render();
      return;
    case "clear-history-filters":
      ui.historySearch = "";
      ui.historyDate = "";
      ui.flash = null;
      render();
      return;
    case "set-notification-status":
      updateNotificationStatus(trigger.dataset.id || "", trigger.dataset.status || "pendiente");
      return;
    default:
      return;
  }
}

function handleChange(event) {
  const trigger = event.target;

  if (
    trigger instanceof HTMLInputElement &&
    trigger.type === "checkbox" &&
    (trigger.dataset.orderSend === "true" || trigger.dataset.orderReceived === "true") &&
    trigger.dataset.branchId &&
    trigger.dataset.brandName &&
    trigger.dataset.productId
  ) {
    if (trigger.checked) {
      sendBranchOrderToKitchenOrders(
        String(trigger.dataset.branchId || ""),
        String(trigger.dataset.brandName || ""),
        String(trigger.dataset.productId || ""),
      );
    }
    return;
  }

  if (
    trigger instanceof HTMLInputElement &&
    trigger.dataset.branchStockInput === "true" &&
    trigger.dataset.branchId &&
    trigger.dataset.brandName &&
    trigger.dataset.productId
  ) {
    updateBranchProductStoreStock(
      String(trigger.dataset.branchId || ""),
      String(trigger.dataset.brandName || ""),
      String(trigger.dataset.productId || ""),
      trigger.value,
    );
    return;
  }

  if (
    trigger instanceof HTMLInputElement &&
    trigger.dataset.branchConsumptionInput === "true" &&
    trigger.dataset.branchId &&
    trigger.dataset.productId
  ) {
    updateBranchConsumptionStoreStock(
      String(trigger.dataset.branchId || ""),
      String(trigger.dataset.productId || ""),
      trigger.value,
    );
    return;
  }

  if (
    trigger instanceof HTMLInputElement &&
    trigger.dataset.branchDailyQuantityInput === "true" &&
    trigger.dataset.branchId &&
    trigger.dataset.productId
  ) {
    updateBranchDailyQuantity(
      String(trigger.dataset.branchId || ""),
      String(trigger.dataset.productId || ""),
      trigger.value,
    );
    return;
  }

  if (
    trigger instanceof HTMLInputElement &&
    trigger.type === "checkbox" &&
    trigger.dataset.branchId &&
    trigger.dataset.brandName &&
    trigger.dataset.productId
  ) {
    toggleBranchProductNeed(
      String(trigger.dataset.branchId || ""),
      String(trigger.dataset.brandName || ""),
      String(trigger.dataset.productId || ""),
      trigger.checked,
    );
    return;
  }

  if (!(trigger instanceof HTMLSelectElement)) {
    return;
  }

  if (trigger.form?.id === "exit-form") {
    updateExitDraftField(trigger.name, trigger.value);
  }

  if (trigger.id === "collaborator-area") {
    hydrateCollaboratorPasswordField();
    return;
  }

  if (trigger.id === "session-operator") {
    session.activeCollaboratorId = String(trigger.value || "");
    saveSession();
    ui.flash = null;

    if (!canAccessColdRoomModule() && ui.currentModule === "cold-room") {
      ui.currentModule = canAccessKitchenModule() ? "kitchen" : "home";
    }

    if (!canAccessKitchenModule() && ui.currentModule === "kitchen") {
      ui.currentModule = "home";
    }

    render();
    return;
  }

  if (trigger.id !== "assignment-product") {
    return;
  }

  const form = trigger.closest("form");
  const quantityField = form?.querySelector("#assignment-quantity");
  if (!(quantityField instanceof HTMLInputElement)) {
    return;
  }

  const product = getProductById(trigger.value);
  quantityField.value = product ? String(product.stockIdeal) : "";
  ui.pendingAssignmentProductId = product ? product.id : "";
}

function handleInput(event) {
  const trigger = event.target;
  if (
    !(trigger instanceof HTMLInputElement) &&
    !(trigger instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  // Manejar cambios en inputs de cantidad entregada
  if (trigger.classList.contains("input-entregado")) {
    handleDeliveredQuantityChange(trigger);
    return;
  }

  if (trigger.form?.id === "product-form" && trigger.id === "product-name") {
    syncProductFormFromName(trigger.form, trigger.value);
    return;
  }

  if (trigger.form?.id !== "exit-form") {
    return;
  }

  updateExitDraftField(trigger.name, trigger.value);
}

function updateExitDraftField(name, value) {
  if (!name || !(name in ui.exitDraft)) {
    return;
  }

  ui.exitDraft[name] = String(value || "");
}

function clearExitDraft() {
  ui.exitDraft = {
    productId: "",
    quantity: "",
    destination: "",
    date: "",
    observation: "",
  };
}

function clearBranchDrafts() {
  return;
}

function submitLogin(form) {
  const formData = new FormData(form);
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const access = resolveLoginAccess(username, password);

  ui.loginUsername = username;

  if (access) {
    session.authenticated = true;
    session.activeCollaboratorId = "";
    session.loginRole = access.role;
    session.loginCollaboratorId = access.collaboratorId || "";

    if (access.autoAuthorizeColdRoom) {
      session.coldRoomAuthorized = true;
      session.coldRoomAccessRole = access.role;
      session.coldRoomAccessCollaboratorId = access.collaboratorId || "";
    } else {
      clearColdRoomAuthorization();
    }

    clearOrdersAuthorization();

    saveSession();
    ui.currentModule = isKitchenOnlyRole(access.role) ? "kitchen" : "home";
    ui.kitchenSection = "panel";
    ui.selectedKitchenBranchId = "";
    ui.selectedKitchenBrand = "";
    ui.coldRoomAccessPrompt = false;
    ui.ordersAccessPrompt = false;
    ui.kitchenOrderPrompt = false;
    ui.kitchenOrderPromptBranchId = "";
    ui.kitchenOrderPromptBrandName = "";
    ui.flash = null;
    ui.loginUsername = "";
    render();
    return;
  }

  setFlash("login", "error", "Usuario o contraseña incorrectos");
  render();
}

function submitColdRoomAccess(form) {
  const formData = new FormData(form);
  const password = String(formData.get("password") || "");
  const access = resolveColdRoomAccess(password);

  if (!access) {
    setFlash(
      "cold-room-access",
      "error",
      "La contrasena no coincide con la clave administrativa ni con la del Encargado activo.",
    );
    render();
    return;
  }

  session.coldRoomAuthorized = true;
  session.coldRoomAccessRole = access.role;
  session.coldRoomAccessCollaboratorId = access.collaboratorId || "";
  saveSession();

  ui.coldRoomAccessPrompt = false;
  ui.currentModule = "cold-room";
  ui.coldRoomSection = ui.coldRoomSection || "equipo";
  ui.flash = null;
  render();
}

function submitHistoryDelete(form) {
  const formData = new FormData(form);
  const password = String(formData.get("password") || "");
  const administrator = resolveAdministratorPassword(password);
  const flashScope = getHistoryDeleteFlashScope(ui.historyDeleteSource);

  if (!administrator) {
    setFlash(
      "history-delete",
      "error",
      "La contrasena no corresponde a ningun Administrador activo.",
    );
    render();
    return;
  }

  const removedCount = state.history.length;
  state.history = [];
  ui.historySearch = "";
  ui.historyDate = "";
  ui.historyDeletePrompt = false;
  ui.historyDeleteSource = "";
  saveState();
  setFlash(
    flashScope,
    "success",
    `Historial eliminado correctamente. Registros borrados: ${removedCount}. Autorizado por ${administrator.name}.`,
  );
  render();
}

function submitCollaborator(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const area = normalizeCollaboratorRole(formData.get("area"));
  const branch = normalizeCollaboratorBranch(formData.get("branch"));
  const status = formData.get("status") === "inactive" ? "inactive" : "active";
  const password = String(formData.get("accessPassword") || "");
  const existingCollaborator = ui.editingCollaboratorId
    ? getCollaboratorById(ui.editingCollaboratorId)
    : null;

  if (!name) {
    setFlash("team", "error", "El colaborador debe tener un nombre.");
    render();
    return;
  }

  if (!area) {
    setFlash("team", "error", "Debes asignar una funcion valida al colaborador.");
    render();
    return;
  }

  if (!branch) {
    setFlash("team", "error", "Debes seleccionar una sucursal valida para el colaborador.");
    render();
    return;
  }

  if (
    requiresCollaboratorPassword(area) &&
    !password &&
    (!existingCollaborator || !existingCollaborator.password)
  ) {
    setFlash("team", "error", getPasswordRequirementMessage(area));
    render();
    return;
  }

  const hasOtherActiveStoreManager = state.collaborators.some(
    (collaborator) =>
      collaborator.id !== ui.editingCollaboratorId &&
      collaborator.status === "active" &&
      normalizeCollaboratorRole(collaborator.area) === "encargado",
  );

  if (area === "encargado" && status === "active" && hasOtherActiveStoreManager) {
    setFlash(
      "team",
      "error",
      "Solo puede existir un Encargado activo, porque es el unico autorizado para despachar mercancia.",
    );
    render();
    return;
  }

  if (ui.editingCollaboratorId) {
    const collaborator = existingCollaborator;
    if (!collaborator) {
      ui.editingCollaboratorId = null;
      setFlash("team", "error", "No se encontró el colaborador que intentabas editar.");
      render();
      return;
    }

    collaborator.name = name;
    collaborator.area = area;
    collaborator.branch = branch;
    collaborator.status = status;
    collaborator.password = requiresCollaboratorPassword(area)
      ? password || collaborator.password
      : "";
    setFlash("team", "success", "Colaborador actualizado correctamente.");
  } else {
    state.collaborators.push({
      id: createId("collaborator"),
      name,
      area,
      branch,
      password: requiresCollaboratorPassword(area) ? password : "",
      status,
      createdAt: new Date().toISOString(),
    });
    setFlash("team", "success", "Colaborador añadido al equipo.");
  }

  ui.editingCollaboratorId = null;
  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function validateAssignmentCollaboratorSelection(form) {
  const formData = new FormData(form);
  const collaboratorId = String(formData.get("collaboratorId") || "");

  if (!collaboratorId) {
    return true;
  }

  const collaborator = getCollaboratorById(collaboratorId);
  if (
    collaborator &&
    collaborator.status === "active" &&
    normalizeCollaboratorRole(collaborator.area) === "cocinero"
  ) {
    return true;
  }

  setFlash(
    "assignment",
    "error",
    "La producción solo puede asignarse a colaboradores activos con rol Cocinero.",
  );
  render();
  return false;
}

function submitAssignment(form) {
  const formData = new FormData(form);
  const collaboratorId = String(formData.get("collaboratorId") || "");
  const productId = String(formData.get("productId") || "");
  const note = String(formData.get("note") || "").trim();

  const collaborator = getCollaboratorById(collaboratorId);
  const product = getProductById(productId);

  if (!collaborator) {
    setFlash("assignment", "error", "Selecciona un colaborador válido.");
    render();
    return;
  }

  if (!product) {
    setFlash(
      "assignment",
      "error",
      "No puedes asignar producción si el producto no existe en la sección Productos.",
    );
    render();
    return;
  }

  const targetQuantity = normalizeNumber(product.stockIdeal, 0);

  if (targetQuantity <= 0) {
    setFlash(
      "assignment",
      "error",
      "El producto debe tener un stock ideal mayor que cero para poder asignar producción.",
    );
    render();
    return;
  }

  const existingAssignment = state.assignments.find(
    (assignment) =>
      assignment.collaboratorId === collaboratorId && assignment.productId === productId,
  );

  if (existingAssignment) {
    existingAssignment.targetQuantity = targetQuantity;
    existingAssignment.note = note;
    setFlash("assignment", "success", "La asignación se actualizó con la nueva producción.");
  } else {
    state.assignments.push({
      id: createId("assignment"),
      collaboratorId,
      productId,
      targetQuantity,
      note,
      createdAt: new Date().toISOString(),
    });
    setFlash("assignment", "success", "Producción vinculada correctamente.");
  }

  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function submitProduct(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const unit = PRODUCT_DEFAULT_UNIT;
  const stockCurrent = normalizeNumber(formData.get("stockCurrent"), 0);
  const stockIdeal = normalizeNumber(formData.get("stockIdeal"), 0);

  if (!name || !unit) {
    setFlash("products", "error", "El producto necesita nombre y unidad de medida.");
    render();
    return;
  }

  if (stockCurrent < 0 || stockIdeal < 0) {
    setFlash("products", "error", "Los valores de stock no pueden ser negativos.");
    render();
    return;
  }

  const matchedExistingProduct =
    getProductByName(name, ui.editingProductId || "") ||
    (ui.productMatchId ? getProductById(ui.productMatchId) : null);
  const targetProductId =
    ui.editingProductId || (matchedExistingProduct ? matchedExistingProduct.id : "");
  let savedProduct = null;

  if (targetProductId) {
    const product = getProductById(targetProductId);
    if (!product) {
      ui.editingProductId = null;
      setFlash("products", "error", "No se encontró el producto que querías editar.");
      render();
      return;
    }

    product.name = name;
    product.unit = unit;
    product.category = product.category || "";
    product.stockCurrent = stockCurrent;
    product.stockIdeal = stockIdeal;
    product.status = product.status === "inactive" ? "inactive" : "active";
    savedProduct = product;
    setFlash(
      "products",
      "success",
      ui.editingProductId
        ? "Producto actualizado correctamente."
        : "Producto existente cargado y actualizado correctamente.",
    );
  } else {
    savedProduct = {
      id: createId("product"),
      name,
      unit,
      category: "",
      stockCurrent,
      stockIdeal,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    state.products.push(savedProduct);
    setFlash("products", "success", "Producto registrado en el sistema.");
  }

  reconcileNotificationsWithInventory();
  ui.editingProductId = null;
  ui.productMatchId = "";
  ui.pendingAssignmentProductId = "";
  ui.productProductionPrompt =
    stockIdeal > 0 &&
    roundStock(stockCurrent) !== roundStock(stockIdeal) &&
    Boolean(savedProduct);
  ui.productProductionProductId =
    ui.productProductionPrompt && savedProduct ? savedProduct.id : "";
  saveState();
  render();
}

function submitOrdersAccess(form) {
  const formData = new FormData(form);
  const password = String(formData.get("password") || "");
  const administrator = resolveAdministratorPassword(password);

  if (!administrator) {
    setFlash(
      "orders-access",
      "error",
      "La contrasena no corresponde a ningun Administrador activo.",
    );
    render();
    return;
  }

  session.ordersAuthorized = true;
  session.ordersAccessCollaboratorId = administrator.id || "";
  saveSession();

  ui.ordersAccessPrompt = false;
  ui.currentModule = "orders";
  ui.selectedBranchId = "";
  ui.selectedBranchBrand = "";
  clearBranchDrafts();
  ui.flash = null;
  render();
}

function submitEntry(form) {
  const formData = new FormData(form);
  const productId = String(formData.get("productId") || "");
  const quantity = normalizeNumber(formData.get("quantity"), 0);
  const stockIdeal = normalizeNumber(formData.get("stockIdeal"), 0);
  const date = String(formData.get("date") || today());
  const collaboratorId = String(formData.get("collaboratorId") || "");
  const observation = String(formData.get("observation") || "").trim();

  const product = getProductById(productId);
  const collaborator = collaboratorId ? getCollaboratorById(collaboratorId) : null;

  if (!product) {
    setFlash("entry", "error", "Selecciona un producto creado previamente en Productos.");
    render();
    return;
  }

  if (quantity <= 0) {
    setFlash("entry", "error", "La cantidad de entrada debe ser mayor que cero.");
    render();
    return;
  }

  if (stockIdeal < 0) {
    setFlash("entry", "error", "El stock ideal no puede ser negativo.");
    render();
    return;
  }

  product.stockCurrent = roundStock(product.stockCurrent + quantity);
  product.stockIdeal = stockIdeal;

  state.history.unshift({
    id: createId("history"),
    type: "entrada",
    date,
    createdAt: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    quantity,
    unit: product.unit,
    collaboratorId: collaborator ? collaborator.id : "",
    collaboratorName: collaborator ? collaborator.name : "Sin colaborador asignado",
    destination: "",
    observation,
    stockAfter: product.stockCurrent,
    stockIdeal: product.stockIdeal,
    notificationId: "",
    notificationMessage: "",
  });

  const tasksClosed = reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "entry",
    "success",
    tasksClosed
      ? "Entrada registrada, stock actualizado y tareas pendientes cerradas automáticamente."
      : "Entrada registrada y stock actualizado en tiempo real.",
  );
  render();
}

function submitExit(form) {
  const formData = new FormData(form);
  const productId = String(formData.get("productId") || "");
  const quantity = normalizeNumber(formData.get("quantity"), 0);
  const destination = String(formData.get("destination") || "").trim();
  const date = String(formData.get("date") || today());
  const observation = String(formData.get("observation") || "").trim();
  const dispatchActor = getDispatchActor();

  if (!canDispatchProducts()) {
    setFlash("exit", "error", getDispatchAccessMessage());
    render();
    return;
  }

  const exitResult = registerProductExitOperation({
    productId,
    quantity,
    destination,
    date,
    observation,
    dispatchActor,
  });

  if (!exitResult.ok) {
    setFlash("exit", "error", exitResult.error);
    render();
    return;
  }

  saveState();
  clearExitDraft();
  setFlash(
    "exit",
    "success",
    exitResult.requiresReplenishment
      ? "Salida registrada, stock descontado y alerta pendiente enviada automáticamente a Cocina."
      : "Salida registrada y stock descontado. El producto sigue abastecido, por lo que no quedó tarea pendiente en Cocina.",
  );
  render();
}

function registerProductExitOperation({
  productId,
  quantity,
  destination,
  date = today(),
  observation = "",
  dispatchActor = getDispatchActor(),
}) {
  const product = getProductById(productId);

  if (!product) {
    return {
      ok: false,
      error: "Selecciona un producto existente para registrar la salida.",
    };
  }

  if (quantity <= 0) {
    return {
      ok: false,
      error: "La cantidad saliente debe ser mayor que cero.",
    };
  }

  if (!destination) {
    return {
      ok: false,
      error: "Debes indicar la sucursal destino.",
    };
  }

  if (quantity > product.stockCurrent) {
    return {
      ok: false,
      error: `No puedes sacar ${formatNumber(quantity)} ${product.unit}. Solo hay ${formatNumber(product.stockCurrent)} ${product.unit} disponibles.`,
    };
  }

  product.stockCurrent = roundStock(product.stockCurrent - quantity);

  const requiresReplenishment = isProductLowStock(product);
  const assignedCollaborators = getActiveAssignedCollaboratorNames(product.id);
  const notificationMessage = requiresReplenishment
    ? `El stock del producto ${product.name} bajó por salida de ${formatNumber(quantity)} ${product.unit}. Reponer lo más pronto posible.`
    : `Se registró una salida de ${formatNumber(quantity)} ${product.unit} del producto ${product.name}, pero el inventario sigue abastecido en Cuarto Frío.`;
  const notificationId = createId("notification");

  state.notifications.unshift({
    id: notificationId,
    productId: product.id,
    productName: product.name,
    quantity,
    unit: product.unit,
    message: notificationMessage,
    date,
    createdAt: new Date().toISOString(),
    destination,
    collaboratorNames: assignedCollaborators,
    status: requiresReplenishment ? "pendiente" : "completada",
    taskRequired: requiresReplenishment,
    completedAt: requiresReplenishment ? "" : new Date().toISOString(),
    sourceHistoryId: "",
    sourceOrderId: "",
    sourceType: "cold_room",
    branchId: "",
    brandName: "",
  });

  const historyId = createId("history");
  state.history.unshift({
    id: historyId,
    type: "salida",
    date,
    createdAt: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    quantity,
    unit: product.unit,
    collaboratorId: dispatchActor ? dispatchActor.id : "",
    collaboratorName: dispatchActor ? dispatchActor.name : "Operador no identificado",
    destination,
    observation,
    stockAfter: product.stockCurrent,
    stockIdeal: product.stockIdeal,
    notificationId,
    notificationMessage,
  });

  const notification = state.notifications.find((item) => item.id === notificationId);
  if (notification) {
    notification.sourceHistoryId = historyId;
  }

  return {
    ok: true,
    product,
    requiresReplenishment,
    notificationId,
    historyId,
    notificationMessage,
  };
}

function deleteCollaborator(collaboratorId) {
  const collaborator = getCollaboratorById(collaboratorId);
  if (!collaborator) {
    setFlash("team", "error", "No se encontró el colaborador que querías eliminar.");
    render();
    return;
  }

  state.collaborators = state.collaborators.filter((item) => item.id !== collaboratorId);
  state.assignments = state.assignments.filter((item) => item.collaboratorId !== collaboratorId);

  if (ui.editingCollaboratorId === collaboratorId) {
    ui.editingCollaboratorId = null;
  }

  if (ui.collaboratorPasswordCollaboratorId === collaboratorId) {
    ui.collaboratorPasswordPrompt = false;
    ui.collaboratorPasswordCollaboratorId = "";
  }

  if (session.activeCollaboratorId === collaboratorId) {
    session.activeCollaboratorId = "";
    saveSession();
  }

  reconcileNotificationsWithInventory();
  saveState();
  setFlash("team", "success", "Colaborador eliminado del equipo y desvinculado de producción.");
  render();
}

function deleteAssignment(assignmentId) {
  const exists = state.assignments.some((assignment) => assignment.id === assignmentId);
  if (!exists) {
    setFlash("assignment", "error", "La asignación que intentabas eliminar ya no existe.");
    render();
    return;
  }

  state.assignments = state.assignments.filter((assignment) => assignment.id !== assignmentId);
  reconcileNotificationsWithInventory();
  saveState();
  setFlash("assignment", "success", "Asignación eliminada correctamente.");
  render();
}

function deleteProduct(productId) {
  const product = getProductById(productId);
  if (!product) {
    setFlash("products", "error", "No se encontró el producto que querías eliminar.");
    render();
    return;
  }

  const removedAssignments = state.assignments.filter(
    (assignment) => assignment.productId === productId,
  ).length;
  const removedNotifications = state.notifications.filter(
    (notification) => notification.productId === productId,
  ).length;
  const removedBranchRequests = state.branchNeeds.reduce(
    (total, branchNeed) => total + (branchNeed.productIds.includes(productId) ? 1 : 0),
    0,
  );

  state.products = state.products.filter((item) => item.id !== productId);
  state.assignments = state.assignments.filter((assignment) => assignment.productId !== productId);
  state.notifications = state.notifications.filter((notification) => notification.productId !== productId);
  state.branchCatalogs = (state.branchCatalogs || defaultBranchCatalogs()).map((branchCatalog) => ({
    ...branchCatalog,
    productIds: (branchCatalog.productIds || []).filter((currentProductId) => currentProductId !== productId),
    updatedAt:
      (branchCatalog.productIds || []).includes(productId) ? new Date().toISOString() : branchCatalog.updatedAt,
  }));
  state.branchStorage = state.branchStorage.map((branchStorage) => ({
    ...branchStorage,
    stockByProductId: Object.entries(branchStorage.stockByProductId || {}).reduce(
      (stockMap, [currentProductId, stockValue]) => {
        if (currentProductId !== productId) {
          stockMap[currentProductId] = stockValue;
        }
        return stockMap;
      },
      {},
    ),
    updatedAt:
      Object.prototype.hasOwnProperty.call(branchStorage.stockByProductId || {}, productId)
        ? new Date().toISOString()
        : branchStorage.updatedAt,
  }));
  state.branchConsumption = state.branchConsumption.map((branchConsumption) => ({
    ...branchConsumption,
    consumptionByProductId: Object.entries(branchConsumption.consumptionByProductId || {}).reduce(
      (consumptionMap, [currentProductId, consumptionValue]) => {
        if (currentProductId !== productId) {
          consumptionMap[currentProductId] = consumptionValue;
        }
        return consumptionMap;
      },
      {},
    ),
    updatedAt:
      Object.prototype.hasOwnProperty.call(branchConsumption.consumptionByProductId || {}, productId)
        ? new Date().toISOString()
        : branchConsumption.updatedAt,
  }));
  state.branchDailyQuantities = (state.branchDailyQuantities || defaultBranchDailyQuantities()).map(
    (branchDailyQuantity) => ({
      ...branchDailyQuantity,
      dailyQuantityByProductId: Object.entries(branchDailyQuantity.dailyQuantityByProductId || {}).reduce(
        (dailyQuantityMap, [currentProductId, dailyQuantityValue]) => {
          if (currentProductId !== productId) {
            dailyQuantityMap[currentProductId] = dailyQuantityValue;
          }
          return dailyQuantityMap;
        },
        {},
      ),
      updatedAt:
        Object.prototype.hasOwnProperty.call(
          branchDailyQuantity.dailyQuantityByProductId || {},
          productId,
        )
          ? new Date().toISOString()
          : branchDailyQuantity.updatedAt,
    }),
  );
  state.branchNeeds = state.branchNeeds.map((branchNeed) => ({
    ...branchNeed,
    productIds: branchNeed.productIds.filter((currentProductId) => currentProductId !== productId),
    stockByProductId: Object.entries(branchNeed.stockByProductId || {}).reduce(
      (stockMap, [currentProductId, stockValue]) => {
        if (currentProductId !== productId) {
          stockMap[currentProductId] = stockValue;
        }
        return stockMap;
      },
      {},
    ),
    updatedAt: branchNeed.productIds.includes(productId) ? new Date().toISOString() : branchNeed.updatedAt,
  }));

  if (ui.editingProductId === productId) {
    ui.editingProductId = null;
  }

  saveState();
  setFlash(
    "products",
    "success",
    `Producto eliminado correctamente. También se limpiaron ${removedAssignments} asignaciones, ${removedNotifications} notificaciones y ${removedBranchRequests} solicitudes de sucursales relacionadas.`,
  );
  render();
}

function updateNotificationStatus(notificationId, nextStatus) {
  if (!canManageNotificationTasks()) {
    setFlash(
      "notifications",
      "error",
      "Las tareas solo se pueden cambiar desde el modulo Cocina.",
    );
    render();
    return;
  }

  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification) {
    setFlash("notifications", "error", "La notificación ya no está disponible.");
    render();
    return;
  }

  if (normalizeNotificationSourceType(notification.sourceType, notification) === "branch_stock") {
    setFlash(
      "notifications",
      "info",
      "Las solicitudes de tienda se envian al encargado y se despachan desde Cuarto Frio con Dar salida.",
    );
    render();
    return;
  }

  const product = getProductById(notification.productId);
  const stocked = !product || !isProductLowStock(product);

  if (nextStatus === "completada") {
    if (!product) {
      setFlash(
        "notifications",
        "error",
        "No se puede completar la reposición porque el producto ya no existe.",
      );
      render();
      return;
    }

    const replenishedQuantity = getProductShortage(product);
    const orderWorkResult = applyKitchenNotificationCompletionToOrders(notification);

    if (replenishedQuantity <= 0) {
      notification.status = "completada";
      notification.completedAt = notification.completedAt || new Date().toISOString();
      saveState();
      setFlash(
        "notifications",
        "info",
        orderWorkResult.removedOrders.length > 0
          ? `Ese producto ya estaba abastecido en Cuarto Frío, así que la tarea se cerró sin cargar stock adicional. También se retiraron ${orderWorkResult.removedOrders.length} pedido(s) trabajados del módulo Pedidos.`
          : "Ese producto ya estaba abastecido en Cuarto Frío, así que la tarea se cerró sin cargar stock adicional.",
      );
      render();
      return;
    }

    product.stockCurrent = roundStock(product.stockCurrent + replenishedQuantity);

    const collaboratorNames = getActiveAssignedCollaboratorNames(product.id);
    const historyId = createId("history");

    state.history.unshift({
      id: historyId,
      type: "entrada",
      date: today(),
      createdAt: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      quantity: replenishedQuantity,
      unit: product.unit,
      collaboratorId: "",
      collaboratorName:
        collaboratorNames.length > 0
          ? collaboratorNames.join(", ")
          : "Reposición automática desde Cocina",
      destination: "Reposición interna",
      observation: "Reposición completada desde Cocina.",
      stockAfter: product.stockCurrent,
      stockIdeal: product.stockIdeal,
      notificationId: notification.id,
      notificationMessage: notification.message,
    });

    notification.quantity = replenishedQuantity;
    notification.collaboratorNames = collaboratorNames;
    notification.sourceHistoryId = historyId;
    notification.status = "completada";
    notification.completedAt = new Date().toISOString();

    reconcileNotificationsWithInventory();
    saveState();
    setFlash(
      "notifications",
      "success",
      orderWorkResult.removedOrders.length > 0
        ? `Reposición completada. Se cargaron ${formatNumber(replenishedQuantity)} ${product.unit} directamente al almacén y se retiraron ${orderWorkResult.removedOrders.length} pedido(s) trabajados del módulo Pedidos.`
        : `Reposición completada. Se cargaron ${formatNumber(replenishedQuantity)} ${product.unit} directamente al almacén.`,
    );
    render();
    return;
  }

  if (nextStatus !== "completada" && stocked) {
    setFlash(
      "notifications",
      "info",
      "Ese producto ya está abastecido en Cuarto Frío, así que no puede quedar como tarea pendiente.",
    );
    render();
    return;
  }

  notification.status = normalizeNotificationStatus(nextStatus);
  if (notification.status === "completada") {
    notification.completedAt = notification.completedAt || new Date().toISOString();
  }
  saveState();
  setFlash("notifications", "success", "Estado de la notificación actualizado.");
  render();
}

function applyKitchenNotificationCompletionToOrders(notification) {
  if (!notification?.productId) {
    return {
      updated: false,
      removedOrders: [],
    };
  }

  const workedAt = new Date().toISOString();
  const removedOrders = [];
  let updated = false;

  state.kitchenOrders = state.kitchenOrders.filter((order) => {
    if (!Array.isArray(order.items) || order.items.length === 0) {
      return true;
    }

    let orderChanged = false;
    order.items = order.items.map((item) => {
      const delivered = roundStock(normalizeNumber(item.delivered, 0));
      if (item.productId !== notification.productId || delivered <= 0) {
        return item;
      }

      if (item.workedInKitchen === true) {
        return item;
      }

      updated = true;
      orderChanged = true;
      return {
        ...item,
        workedInKitchen: true,
        workedAt,
      };
    });

    if (!orderChanged) {
      return true;
    }

    const allWorked = order.items.every((item) => {
      const delivered = roundStock(normalizeNumber(item.delivered, 0));
      const pending = roundStock(Math.max(normalizeNumber(item.pending, 0), 0));
      return delivered > 0 && pending <= 0 && item.workedInKitchen === true;
    });

    if (allWorked) {
      removedOrders.push(order.number || order.id);
      return false;
    }

    return true;
  });

  return {
    updated,
    removedOrders,
  };
}

function updateBranchNotificationStatus(notification, nextStatus) {
  const product = getProductById(notification.productId);
  const branch = getBranchLocationById(notification.branchId);
  const normalizedBrandName = normalizeBranchBrand(notification.brandName);
  const record = getBranchNeedRecord(notification.branchId, normalizedBrandName);
  const shortage = product ? getBranchProductRequestShortage(record, product) : 0;

  if (!product || !branch || !normalizedBrandName) {
    notification.status = "completada";
    notification.completedAt = notification.completedAt || new Date().toISOString();
    saveState();
    setFlash("notifications", "info", "La alerta de tienda se cerró porque su contexto ya no está disponible.");
    render();
    return;
  }

  if (nextStatus === "completada") {
    if (shortage <= 0) {
      notification.status = "completada";
      notification.completedAt = notification.completedAt || new Date().toISOString();
      saveState();
      setFlash(
        "notifications",
        "info",
        "Esa tienda ya estaba abastecida, así que la tarea se cerró sin cargar stock adicional.",
      );
      render();
      return;
    }

    setBranchStoreStockValue(
      notification.branchId,
      product.id,
      getBranchProductRequestBase(notification.branchId, product),
      new Date().toISOString(),
    );

    notification.quantity = shortage;
    notification.destination = formatBranchDestination(branch, normalizedBrandName);
    notification.status = "completada";
    notification.completedAt = new Date().toISOString();
    reconcileNotificationsWithInventory();
    saveState();
    setFlash(
      "notifications",
      "success",
      `Reposición completada para ${branch.name} / ${normalizedBrandName}. Se cargaron ${formatNumber(shortage)} ${product.unit} al stock de tienda.`,
    );
    render();
    return;
  }

  if (shortage <= 0) {
    setFlash(
      "notifications",
      "info",
      "Esa tienda ya está abastecida, así que no puede quedar como tarea pendiente.",
    );
    render();
    return;
  }

  notification.status = normalizeNotificationStatus(nextStatus);
  if (notification.status === "completada") {
    notification.completedAt = notification.completedAt || new Date().toISOString();
  }
  saveState();
  setFlash("notifications", "success", "Estado de la notificación actualizado.");
  render();
}

function render() {
  syncSessionWithCollaborators();
  app.innerHTML = session.authenticated ? renderShell() : renderLogin();
  syncLayoutOffsets();
  hydrateRoleField();
  hydrateCollaboratorBranchField();
  hydrateCollaboratorPasswordField();
  hydrateExitAccess();
  hydratePendingAssignmentForm();
  hydrateProductFormState();
  updateLiveTimers();
  syncPresenceLifecycle();
  presenceSync.activeSignature = getPresenceRenderSignature();
}

function syncLayoutOffsets() {
  const root = document.documentElement;
  root.style.setProperty("--topbar-offset", "0px");
}

function renderFatalError(error) {
  if (!app) {
    return;
  }

  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  app.innerHTML = `
    <section class="login-screen">
      <div class="login-card">
        <div class="login-header">
          <div class="brand-plate">GreenSalad</div>
          <h1 class="login-title">Proyecto Venezuela</h1>
          <p class="login-copy">Se detecto un error al cargar la aplicacion.</p>
        </div>
        <div class="feedback error">${escapeHtml(message || "Error desconocido")}</div>
      </div>
    </section>
  `;
}

function renderLogin() {
  return `
    <section class="login-screen">
      <div class="login-card">
        <div class="login-header">
          <div class="brand-plate">GreenSalad</div>
          <h1 class="login-title">Proyecto Venezuela</h1>
          <p class="login-copy">Accede con Green o con las credenciales activas de cualquier usuario creado en el sistema.</p>
        </div>
        ${renderFlash("login")}
        <form id="login-form" class="form-stack" autocomplete="off">
          <div class="field">
            <label for="login-username">Usuario</label>
            <input
              id="login-username"
              type="text"
              name="username"
              value="${escapeHtml(ui.loginUsername)}"
              placeholder="Ingresa tu usuario"
              required
            />
          </div>
          <div class="field">
            <label for="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              name="password"
              placeholder="Ingresa tu contraseña"
              required
            />
          </div>
          <button class="btn btn-primary btn-block" type="submit">Iniciar sesión</button>
        </form>
      </div>
    </section>
  `;
}

function renderShell() {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-brand">
          <div class="brand-badge">GreenSalad</div>
          <div class="topbar-copy">
            <p class="eyebrow">Sistema operativo</p>
            <h1>Proyecto LuRo</h1>
            <p>Inventario, producción y reposición enlazados entre Cuarto Frío y Cocina.</p>
          </div>
        </div>
        <div class="topbar-actions">
          ${renderSyncBadge()}
          ${renderActiveSessionBadge()}
          <button class="btn ${ui.currentModule === "home" ? "btn-primary" : "btn-ghost"}" data-action="go-home">
            Módulos
          </button>
          <button class="btn btn-ghost" data-action="logout">Cerrar sesión</button>
        </div>
      </header>
      ${renderSyncBanner()}
      ${renderFlash("session")}
      <main class="page-content">
        ${renderCurrentModule()}
      </main>
      ${renderKitchenOrderAuthModal()}
      ${renderProductProductionModal()}
      ${renderCollaboratorPasswordModal()}
      ${renderColdRoomAccessModal()}
      ${renderOrdersAccessModal()}
      ${renderHistoryDeleteModal()}
    </div>
  `;
}

function renderActiveSessionBadge() {
  const identity = getAuthenticatedIdentity();
  if (!identity) {
    return "";
  }

  return `
    <div class="session-pill" aria-label="Usuario activo">
      <span class="session-pill-label">Activo</span>
      <strong>${escapeHtml(identity.name)}</strong>
      <span class="session-pill-role">${escapeHtml(formatCollaboratorRole(identity.role))}</span>
    </div>
  `;
}

function renderKitchenOrderAuthModal() {
  if (!ui.kitchenOrderPrompt) {
    return "";
  }

  const branch = getBranchLocationById(ui.kitchenOrderPromptBranchId);
  const brandName = normalizeBranchBrand(ui.kitchenOrderPromptBrandName);
  const leader = branch ? getActiveTurnLeaderByBranch(branch.name) : null;
  const draftItems = branch && brandName ? getKitchenOrderDraftItems(branch.id, brandName) : [];

  if (!branch || !brandName || !leader) {
    return "";
  }

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="kitchen-order-auth-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-kitchen-order-auth" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <h2 id="kitchen-order-auth-title">Autorizar pedido de Cocina</h2>
              <p>Ingresa la contrasena del Lider de turno activo para enviar este pedido de ${escapeHtml(branch.name)} / ${escapeHtml(brandName)}.</p>
            </div>
          </div>
          <div class="feedback info">Lider de turno requerido: ${escapeHtml(leader.name)}.</div>
          ${renderFlash("kitchen-order-auth")}
          <div class="subtle-list">
            <div class="subtle-item">
              <span class="text-soft">Productos seleccionados</span>
              <strong>${draftItems.length}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Cantidad total solicitada</span>
              <strong>${formatNumber(draftItems.reduce((total, item) => total + item.requested, 0))}</strong>
            </div>
          </div>
          <form id="kitchen-order-auth-form" class="form-stack" autocomplete="off">
            <div class="field">
              <label for="kitchen-order-password">Contrasena del Lider de turno</label>
              <input
                id="kitchen-order-password"
                name="password"
                type="password"
                placeholder="Ingresa la contrasena"
                required
                autofocus
              />
            </div>
            <div class="actions-row">
              <button class="btn btn-primary" type="submit">Autorizar y enviar pedido</button>
              <button class="btn btn-ghost" type="button" data-action="cancel-kitchen-order-auth">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderProductProductionModal() {
  if (!ui.productProductionPrompt) {
    return "";
  }

  const product = getProductById(ui.productProductionProductId);
  if (!product) {
    return "";
  }

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="product-production-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-product-production" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Producto registrado</p>
              <h2 id="product-production-title">Enviar a producir</h2>
              <p>El producto ya quedo guardado. Quieres enviarlo ahora al flujo de produccion?</p>
            </div>
          </div>
          <div class="subtle-list">
            <div class="subtle-item">
              <span class="text-soft">Producto</span>
              <strong>${escapeHtml(product.name)}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Stock ideal</span>
              <strong>${formatNumber(product.stockIdeal)} ${escapeHtml(product.unit)}</strong>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn btn-primary" type="button" data-action="confirm-product-production">
              Si, enviar a producir
            </button>
            <button class="btn btn-ghost" type="button" data-action="cancel-product-production">
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCollaboratorPasswordModal() {
  if (!ui.collaboratorPasswordPrompt) {
    return "";
  }

  const collaborator = getCollaboratorById(ui.collaboratorPasswordCollaboratorId);
  if (!collaborator) {
    return "";
  }

  const hasPassword = Boolean(String(collaborator.password || "").trim());

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="collaborator-password-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-collaborator-password" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Acceso del colaborador</p>
              <h2 id="collaborator-password-title">${escapeHtml(collaborator.name)}</h2>
              <p>Consulta la contrasena actual del colaborador seleccionado.</p>
            </div>
          </div>
          <div class="subtle-list">
            <div class="subtle-item">
              <span class="text-soft">Rol</span>
              <strong>${escapeHtml(formatCollaboratorRole(collaborator.area))}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Sucursal</span>
              <strong>${escapeHtml(collaborator.branch || "Sin sucursal")}</strong>
            </div>
          </div>
          ${
            hasPassword
              ? `
                <div class="field">
                  <label for="collaborator-current-password">Contrasena actual</label>
                  <input
                    id="collaborator-current-password"
                    type="text"
                    value="${escapeHtml(collaborator.password)}"
                    readonly
                  />
                </div>
              `
              : `
                <div class="feedback info">
                  Este colaborador no tiene una contrasena asignada actualmente.
                </div>
              `
          }
          <div class="actions-row">
            <button class="btn btn-ghost" type="button" data-action="cancel-collaborator-password">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTechnicalModal() {
  if (!ui.techPanelPrompt) {
    return "";
  }

  const snapshot = getTechnicalSnapshot();

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window tech-window" role="dialog" aria-modal="true" aria-labelledby="tech-panel-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-tech-panel" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card tech-modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Vista tecnica</p>
              <h2 id="tech-panel-title">Estado operativo interno</h2>
              <p>Usa esta ventana para revisar datos, sincronizacion y modulo activo sin depender de F12.</p>
            </div>
          </div>

          <section class="tech-grid">
            <article class="stat-card">
              <h3>Sesion actual</h3>
              <div class="subtle-list">
                <div class="subtle-item">
                  <span class="text-soft">Modulo</span>
                  <strong>${escapeHtml(snapshot.session.currentModule)}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Login</span>
                  <strong>${escapeHtml(snapshot.session.loginRole)}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Acceso a Cuarto Frio</span>
                  <strong>${escapeHtml(snapshot.session.coldRoomAccess)}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Viewport</span>
                  <strong>${escapeHtml(snapshot.session.viewport)}</strong>
                </div>
              </div>
            </article>

            <article class="stat-card">
              <h3>Resumen del sistema</h3>
              <div class="subtle-list">
                <div class="subtle-item">
                  <span class="text-soft">Productos</span>
                  <strong>${snapshot.summary.products}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Colaboradores</span>
                  <strong>${snapshot.summary.collaborators}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Notificaciones activas</span>
                  <strong>${snapshot.summary.pendingNotifications}</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Historial</span>
                  <strong>${snapshot.summary.history}</strong>
                </div>
              </div>
            </article>
          </section>

          <div class="tech-code-shell">
            <h3>Datos sincronizados</h3>
            <pre class="code-view">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderColdRoomAccessModal() {
  if (!ui.coldRoomAccessPrompt) {
    return "";
  }

  const activeStoreManager = getActiveStoreManager();

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="cold-room-access-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-cold-room-access" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Ventana flotante</p>
              <h2 id="cold-room-access-title">Acceso a Cuarto Frio</h2>
              <p>Ingresa la contrasena maestra, la de un Administrador activo o la clave del Encargado activo para abrir este modulo.</p>
            </div>
          </div>
          ${
            activeStoreManager
              ? `<div class="feedback info">Encargado activo configurado: ${escapeHtml(activeStoreManager.name)}.</div>`
              : `<div class="feedback info">Todavia no hay un Encargado activo con contrasena. Puedes entrar con la clave administrativa.</div>`
          }
          ${renderFlash("cold-room-access")}
          <form id="cold-room-access-form" class="form-stack" autocomplete="off">
            <div class="field">
              <label for="cold-room-password">Contrasena de acceso</label>
              <input
                id="cold-room-password"
                name="password"
                type="password"
                placeholder="Ingresa la contrasena"
                required
                autofocus
              />
            </div>
            <div class="actions-row">
              <button class="btn btn-primary" type="submit">Abrir Cuarto Frio</button>
              <button class="btn btn-ghost" type="button" data-action="cancel-cold-room-access">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderOrdersAccessModal() {
  if (!ui.ordersAccessPrompt) {
    return "";
  }

  const collaborator = getAuthenticatedCollaborator();
  const branchLabel = collaborator?.branch ? normalizeCollaboratorBranch(collaborator.branch) : "";

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="orders-access-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-orders-access" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Ventana flotante</p>
              <h2 id="orders-access-title">Acceso a Pedidos</h2>
              <p>Ingresa la contrasena de un Administrador activo para abrir este modulo. Los miembros con sucursal asignada entran sin autorizacion adicional.</p>
            </div>
          </div>
          ${
            branchLabel
              ? `<div class="feedback info">Tu usuario pertenece a la sucursal ${escapeHtml(branchLabel)}, por lo que deberia entrar directo. Si sigues viendo esta ventana, revisa la sucursal asignada en Equipo.</div>`
              : `<div class="feedback info">Este usuario no tiene una sucursal valida asignada. Usa una clave administrativa para continuar.</div>`
          }
          ${renderFlash("orders-access")}
          <form id="orders-access-form" class="form-stack" autocomplete="off">
            <div class="field">
              <label for="orders-access-password">Contrasena de acceso</label>
              <input
                id="orders-access-password"
                name="password"
                type="password"
                placeholder="Ingresa la contrasena"
                required
                autofocus
              />
            </div>
            <div class="actions-row">
              <button class="btn btn-primary" type="submit">Abrir Pedidos</button>
              <button class="btn btn-ghost" type="button" data-action="cancel-orders-access">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderHistoryDeleteModal() {
  if (!ui.historyDeletePrompt) {
    return "";
  }

  const sourceLabel = getHistoryDeleteSourceLabel(ui.historyDeleteSource);

  return `
    <div class="modal-overlay" role="presentation">
      <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="history-delete-title">
        <div class="modal-window-head">
          <div class="modal-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <button class="modal-close" type="button" data-action="cancel-history-delete" aria-label="Cerrar ventana">
            Cerrar
          </button>
        </div>
        <div class="modal-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Eliminacion protegida</p>
              <h2 id="history-delete-title">Eliminar historial registrado</h2>
              <p>Vas a borrar todas las entradas, salidas y el historial general desde ${escapeHtml(sourceLabel)}.</p>
            </div>
          </div>
          <div class="feedback error">
            Esta accion elimina todo el historial guardado. Solo se aceptan contrasenas de administradores.
          </div>
          ${renderFlash("history-delete")}
          <form id="history-delete-form" class="form-stack" autocomplete="off">
            <div class="field">
              <label for="history-delete-password">Contrasena de administrador</label>
              <input
                id="history-delete-password"
                name="password"
                type="password"
                placeholder="Ingresa la contrasena"
                required
                autofocus
              />
            </div>
            <div class="actions-row">
              <button class="btn btn-danger" type="submit">Eliminar historial</button>
              <button class="btn btn-ghost" type="button" data-action="cancel-history-delete">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderHistoryDeleteButton(source, hasRecords) {
  if (!hasRecords) {
    return "";
  }

  return `
    <button
      class="btn btn-danger btn-small"
      type="button"
      data-action="open-history-delete"
      data-source="${escapeHtml(source)}"
    >
      Eliminar historial
    </button>
  `;
}

function getHistoryDeleteSourceLabel(source) {
  switch (String(source || "")) {
    case "entry":
      return "Ultimas entradas";
    case "exit":
      return "Ultimas salidas";
    case "history":
      return "Historial general";
    default:
      return "este panel";
  }
}

function getHistoryDeleteFlashScope(source) {
  switch (String(source || "")) {
    case "entry":
      return "entry";
    case "exit":
      return "exit";
    case "history":
    default:
      return "history";
  }
}

function renderCurrentModule() {
  if (ui.currentModule === "cold-room" && !canAccessColdRoomModule()) {
    return renderModulesHome();
  }

  if (ui.currentModule === "kitchen" && !canAccessKitchenModule()) {
    return renderModulesHome();
  }

  if (ui.currentModule === "orders" && !canAccessOrdersModule()) {
    return renderModulesHome();
  }

  if (ui.currentModule === "branches" && !canAccessBranchesModule()) {
    return renderModulesHome();
  }

  if (ui.currentModule === "cold-room") {
    return renderColdRoomModule();
  }

  if (ui.currentModule === "kitchen") {
    return renderKitchenModule();
  }

  if (ui.currentModule === "orders") {
    return renderOrdersModule();
  }

  if (ui.currentModule === "branches") {
    return renderBranchesModule();
  }

  return renderModulesHome();
}

function renderModulesHomeLegacy() {
  const lowStockProducts = getLowStockProducts();
  const pendingNotifications = getPendingNotifications();

  return `
    <div class="page-stack">
      <section class="panel soft">
        <div class="hero-copy">
          <p class="eyebrow">Panel principal</p>
          <h2>Módulos</h2>
          <p>Selecciona el área de trabajo. Cada módulo comparte el mismo estado operativo para mantener inventario, equipo, historial y cocina sincronizados.</p>
        </div>
        <div class="summary-grid">
          <div class="stat-card">
            <h3>Productos activos</h3>
            <span class="stat-value">${state.products.length}</span>
            <p>Base operativa disponible para entradas, salidas y asignación de producción.</p>
          </div>
          <div class="stat-card">
            <h3>Equipo registrado</h3>
            <span class="stat-value">${state.collaborators.length}</span>
            <p>Los mismos colaboradores se muestran automáticamente en Cocina.</p>
          </div>
          <div class="stat-card">
            <h3>Reposiciones pendientes</h3>
            <span class="stat-value">${pendingNotifications.length}</span>
            <p>Notificaciones generadas por salidas de Cuarto Frío.</p>
          </div>
        </div>
      </section>

      <section class="module-grid">
        <article class="module-card">
          <div>
            <p class="eyebrow">Centro de control</p>
            <h2>Cuarto Frío</h2>
            <p>Gestiona productos, entradas, salidas, equipo, historial y notificaciones vinculadas con Cocina.</p>
          </div>
          <div class="stat-strip">
            <span class="pill">${state.products.length} productos</span>
            <span class="pill">${lowStockProducts.length} en stock bajo</span>
            <span class="pill">${pendingNotifications.length} avisos activos</span>
          </div>
          <button class="btn btn-primary" data-action="open-module" data-module="cold-room">Abrir Cuarto Frío</button>
        </article>

        <article class="module-card">
          <div>
            <p class="eyebrow">Panel operativo</p>
            <h2>Cocina</h2>
            <p>Consulta el equipo registrado y recibe automáticamente las tareas de reposición generadas desde Cuarto Frío.</p>
          </div>
          <div class="stat-strip">
            <span class="pill">${state.collaborators.length} colaboradores</span>
            <span class="pill">${pendingNotifications.length} tareas activas</span>
            <span class="pill">${state.assignments.length} producciones vinculadas</span>
          </div>
          <button class="btn btn-primary" data-action="open-module" data-module="kitchen">Abrir Cocina</button>
        </article>

      </section>
    </div>
  `;
}

function renderModulesHome() {
  const lowStockProducts = getLowStockProducts();
  const pendingNotifications = getPendingNotifications();
  const totalBranchRequests = getTotalBranchRequestedProducts();
  const activeBranches = getBranchesWithRequestedProducts().length;
  const activeOrderPanels = getOrderPanelsWithRequests().length;
  const hasPendingNotifications = pendingNotifications.length > 0;
  const allowColdRoom = canAccessColdRoomModule();
  const allowKitchen = canAccessKitchenModule();
  const allowOrders = canAccessOrdersModule();
  const allowBranches = canAccessBranchesModule();
  const mustChooseOperator = requiresOperatorSelection();
  const showColdRoomCard = !isKitchenOnlyRole() && !isTurnLeaderRole();
  const showHomeAlert = !isTurnLeaderRole();

  return `
    <div class="page-stack">
      ${
        mustChooseOperator
          ? `
            <section class="panel">
              <div class="section-heading">
                <div>
                  <h2>Selecciona el operador activo</h2>
                  <p>Los permisos del sistema cambian segun el rol del colaborador seleccionado en la parte superior.</p>
                </div>
              </div>
              <div class="subtle-list">
                <div class="subtle-item">
                  <span class="text-soft">Roles con solo Cocina</span>
                  <strong>Cocinero y Utility</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Acceso total</span>
                  <strong>Encargado y Administrador</strong>
                </div>
                <div class="subtle-item">
                  <span class="text-soft">Despacho permitido</span>
                  <strong>Solo Encargado</strong>
                </div>
              </div>
            </section>
          `
          : ""
      }
      ${
        showHomeAlert
          ? `
            <section class="home-alert-wrap">
              <article class="stat-card home-alert-card ${hasPendingNotifications ? "stock-alert-card blink-alert" : ""}">
                <h3>Reposiciones pendientes</h3>
                <span class="stat-value">${pendingNotifications.length}</span>
                <p>Notificaciones generadas por salidas de Cuarto Frío.</p>
              </article>
            </section>
          `
          : ""
      }

      <section class="module-grid centered-home-grid">
        ${
          showColdRoomCard
            ? `
              <article class="module-card home-module-card">
                <div>
                  <p class="eyebrow">Centro de control</p>
                  <h2>Cuarto Frío</h2>
                  <p>Gestiona productos, entradas, salidas, equipo, historial y notificaciones vinculadas con Cocina.</p>
                </div>
                <div class="stat-strip">
                  <span class="pill">${state.products.length} productos</span>
                  <span class="pill">${lowStockProducts.length} en stock bajo</span>
                  <span class="pill">${pendingNotifications.length} avisos activos</span>
                </div>
                <button class="btn ${allowColdRoom ? "btn-primary" : "btn-secondary"}" data-action="open-module" data-module="cold-room">
                  Abrir Cuarto Frío
                </button>
              </article>
            `
            : ""
        }

        ${
          allowKitchen
            ? `
              <article class="module-card home-module-card">
                <div>
                  <p class="eyebrow">Panel operativo</p>
                  <h2>Cocina</h2>
                  <p>Consulta el equipo registrado y recibe automáticamente las tareas de reposición generadas desde Cuarto Frío.</p>
                </div>
                <div class="stat-strip">
                  <span class="pill">${state.collaborators.length} colaboradores</span>
                  <span class="pill">${pendingNotifications.length} tareas activas</span>
                  <span class="pill">${state.assignments.length} producciones vinculadas</span>
                </div>
                <button class="btn btn-primary" data-action="open-module" data-module="kitchen">Abrir Cocina</button>
              </article>
            `
            : ""
        }

        ${
          allowOrders
            ? `
              <article class="module-card home-module-card">
                <div>
                  <p class="eyebrow">Consolidado</p>
                  <h2>Pedidos</h2>
                  <p>Consulta aqui los checkbox marcados desde sucursales y las marcas que tienen pedidos activos.</p>
                </div>
                <div class="stat-strip">
                  <span class="pill">${totalBranchRequests} productos pedidos</span>
                  <span class="pill">${activeBranches} sucursales activas</span>
                  <span class="pill">${activeOrderPanels} marcas con pedidos</span>
                </div>
                <button class="btn btn-primary" data-action="open-module" data-module="orders">Abrir Pedidos</button>
              </article>
            `
            : ""
        }

        ${
          allowBranches
            ? `
              <article class="module-card home-module-card">
                <div>
                  <p class="eyebrow">Red de sucursales</p>
                  <h2>Sucursales</h2>
                  <p>Marca desde cada sucursal los productos que necesitan usando el mismo catalogo registrado en Productos.</p>
                </div>
                <div class="stat-strip">
                  <span class="pill">${BRANCH_LOCATIONS.length} sucursales</span>
                  <span class="pill">${totalBranchRequests} productos solicitados</span>
                  <span class="pill">${activeBranches} con pedidos activos</span>
                </div>
                <button class="btn btn-primary" data-action="open-module" data-module="branches">Abrir Sucursales</button>
              </article>
            `
            : ""
        }
      </section>
    </div>
  `;
}

// Función de diagnóstico de conectividad Firebase
window.diagnoseFirebaseConnection = async function() {
  console.log("=== DIAGNÓSTICO DE CONECTIVIDAD FIREBASE ===");
  
  try {
    // 1. Verificar configuración
    console.log("1. Verificando configuración Firebase...");
    console.log("Project ID:", FIREBASE_CONFIG.projectId);
    console.log("Database ID:", FIRESTORE_DATABASE_ID);
    console.log("Collection:", CLOUD_STATE_COLLECTION);
    console.log("Document:", CLOUD_STATE_DOCUMENT);
    
    // 2. Verificar inicialización de Firebase
    console.log("2. Verificando inicialización de Firebase...");
    console.log("Firebase App:", firebaseApp);
    console.log("Firestore:", firestore);
    
    // 3. Verificar referencias
    console.log("3. Verificando referencias...");
    console.log("Cloud State Ref:", cloudStateRef);
    console.log("Presence Collection Ref:", presenceCollectionRef);
    
    // 4. Intentar conexión simple
    console.log("4. Intentando conexión simple...");
    const testDoc = await getDoc(cloudStateRef);
    console.log("Conexión exitosa:", testDoc.exists());
    
    // 5. Verificar estado actual de sincronización
    console.log("5. Estado actual de sincronización:");
    console.log("cloudSync.status:", cloudSync.status);
    console.log("cloudSync.enabled:", cloudSync.enabled);
    console.log("cloudSync.initialized:", cloudSync.initialized);
    console.log("cloudSync.statusMessage:", cloudSync.statusMessage);
    
    // 6. Verificar estado de red
    console.log("6. Estado de red:");
    console.log("navigator.onLine:", navigator.onLine);
    
    console.log("=== FIN DEL DIAGNÓSTICO ===");
    
    alert("Diagnóstico completado. Revisa la consola para detalles.");
    
  } catch (error) {
    console.error("ERROR EN DIAGNÓSTICO:", error);
    alert("Error en diagnóstico: " + error.message);
  }
};

// Función para forzar reconexión
window.forceReconnectFirebase = async function() {
  console.log("Forzando reconexión a Firebase...");
  
  try {
    // Resetear estado de sincronización
    cloudSync.status = "connecting";
    cloudSync.statusMessage = "Forzando reconexión...";
    cloudSync.enabled = false;
    cloudSync.initialized = false;
    
    if (cloudSync.unsubscribe) {
      cloudSync.unsubscribe();
      cloudSync.unsubscribe = null;
    }
    
    render();
    
    // Reintentar inicialización
    await initializeCloudSync({ retrying: true });
    
    alert("Reconexión forzada. Revisa el estado de sincronización.");
    
  } catch (error) {
    console.error("Error en reconexión forzada:", error);
    alert("Error en reconexión: " + error.message);
  }
};

// Función de emergencia global para eliminar pedidos
window.emergencyDeleteOrder = function(orderId, orderNumber) {
  console.log("Emergency delete called for:", orderId, orderNumber);
  
  if (confirm(`¿Estás seguro de eliminar el pedido ${orderNumber}? Se moverá al historial.`)) {
    try {
      console.log("Confirmed deletion, searching for order...");
      
      // Buscar el pedido directamente
      let orderIndex = -1;
      let order = null;
      
      for (let i = 0; i < state.kitchenOrders.length; i++) {
        if (state.kitchenOrders[i].id === orderId) {
          orderIndex = i;
          order = state.kitchenOrders[i];
          break;
        }
      }
      
      if (!order || orderIndex === -1) {
        console.error("Order not found:", orderId);
        alert('No se encontró el pedido');
        return;
      }
      
      console.log("Order found:", order);
      
      // Cambiar estado a completado
      order.status = "completada";
      order.completedAt = new Date().toISOString();
      order.completedBy = getAuthenticatedCollaborator()?.name || "Sistema";
      
      console.log("Order status changed to completed");
      
      // Actualizar el pedido en el array
      state.kitchenOrders[orderIndex] = order;
      
      // Guardar y renderizar
      reconcileNotificationsWithInventory();
      saveState();
      
      console.log("State saved, rendering...");
      
      alert(`Pedido ${orderNumber} movido al historial correctamente`);
      
      // Forzar renderizado completo
      setTimeout(() => {
        render();
      }, 100);
      
    } catch (error) {
      console.error('Error deleting order:', error);
      alert('Error al eliminar el pedido: ' + error.message);
    }
  }
};

// Función de limpieza masiva para los pedidos específicos
window.cleanSpecificOrders = function() {
  console.log("Cleaning specific orders...");
  
  const ordersToClean = [
    "kitchen-order-565b96a8-5905-43ad-b331-081db38c1b4d", // REQ-2603231011-893
    "kitchen-order-ec938096-ca63-4324-8695-de044acd26d5"  // REQ-2603231011-434
  ];
  
  let cleanedCount = 0;
  
  ordersToClean.forEach(orderId => {
    const orderIndex = state.kitchenOrders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
      const order = state.kitchenOrders[orderIndex];
      
      // Cambiar estado a completado
      order.status = "completada";
      order.completedAt = new Date().toISOString();
      order.completedBy = getAuthenticatedCollaborator()?.name || "Sistema";
      
      state.kitchenOrders[orderIndex] = order;
      cleanedCount++;
      
      console.log("Order cleaned:", order.number);
    }
  });
  
  if (cleanedCount > 0) {
    reconcileNotificationsWithInventory();
    saveState();
    
    alert(`Se movieron ${cleanedCount} pedidos al historial correctamente`);
    
    setTimeout(() => {
      render();
    }, 100);
  } else {
    alert("No se encontraron los pedidos para limpiar");
  }
};

// Función para eliminar TODOS los pedidos activos
window.clearAllActiveOrders = function() {
  console.log("Clearing ALL active orders...");
  
  if (!confirm("¿Estás seguro de eliminar TODOS los pedidos activos? Esta acción no se puede deshacer.")) {
    return;
  }
  
  let clearedCount = 0;
  
  // Recorrer todos los pedidos y marcar como completados
  for (let i = 0; i < state.kitchenOrders.length; i++) {
    const order = state.kitchenOrders[i];
    
    if (order.status !== "completada") {
      order.status = "completada";
      order.completedAt = new Date().toISOString();
      order.completedBy = getAuthenticatedCollaborator()?.name || "Sistema";
      
      state.kitchenOrders[i] = order;
      clearedCount++;
      
      console.log("Order cleared:", order.number);
    }
  }
  
  if (clearedCount > 0) {
    reconcileNotificationsWithInventory();
    saveState();
    
    alert(`Se eliminaron ${clearedCount} pedidos activos correctamente`);
    
    setTimeout(() => {
      render();
    }, 100);
  } else {
    alert("No hay pedidos activos para eliminar");
  }
};

// Función para forzar eliminación del pedido problemático
window.forceDeleteSpecificOrder = function(orderId, orderNumber) {
  console.log("Force deleting specific order:", orderId, orderNumber);
  
  if (!confirm(`¿Forzar eliminación del pedido ${orderNumber}? Esto moverá todas las ocurrencias al historial.`)) {
    return;
  }
  
  try {
    let deletedCount = 0;
    
    // Buscar y eliminar TODAS las ocurrencias del pedido
    for (let i = state.kitchenOrders.length - 1; i >= 0; i--) {
      const order = state.kitchenOrders[i];
      
      if (order.id === orderId && order.status !== "completada") {
        console.log("Found order to delete:", order.number, "at index:", i);
        
        // Marcar como completado
        order.status = "completada";
        order.completedAt = new Date().toISOString();
        order.completedBy = getAuthenticatedCollaborator()?.name || "Sistema";
        
        state.kitchenOrders[i] = order;
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      reconcileNotificationsWithInventory();
      saveState();
      
      alert(`Se eliminaron ${deletedCount} ocurrencias del pedido ${orderNumber} correctamente`);
      
      // Forzar recarga completa de la página
      setTimeout(() => {
        location.reload();
      }, 500);
      
    } else {
      alert("No se encontraron ocurrencias activas de este pedido");
    }
    
  } catch (error) {
    console.error("Error force deleting order:", error);
    alert("Error al forzar eliminación: " + error.message);
  }
};

// Función para eliminar todo el historial de pedidos
window.clearAllHistory = function() {
  console.log("Clearing ALL history orders...");
  
  if (!confirm("¿Estás seguro de eliminar TODO el historial de pedidos? Esta acción eliminará permanentemente todos los pedidos completados y no se puede deshacer.")) {
    return;
  }
  
  try {
    let deletedCount = 0;
    
    // Eliminar todos los pedidos con status "completada"
    for (let i = state.kitchenOrders.length - 1; i >= 0; i--) {
      const order = state.kitchenOrders[i];
      
      if (order.status === "completada") {
        console.log("Deleting history order:", order.number);
        
        // Eliminar completamente del array
        state.kitchenOrders.splice(i, 1);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      reconcileNotificationsWithInventory();
      saveState();
      
      alert(`Se eliminaron ${deletedCount} pedidos del historial correctamente`);
      
      // Forzar recarga completa
      setTimeout(() => {
        location.reload();
      }, 500);
      
    } else {
      alert("No hay pedidos en el historial para eliminar");
    }
    
  } catch (error) {
    console.error("Error clearing history:", error);
    alert("Error al limpiar historial: " + error.message);
  }
};

function renderOrdersModule() {
  const orderPanels = getOrderPanelsWithRequests();
  const kitchenOrders = getSortedKitchenOrders();
  const activeKitchenOrders = kitchenOrders.filter((order) => order.status !== "completada");
  const pendingKitchenOrders = activeKitchenOrders.filter((order) => order.forwardedToDispatch !== true);
  const forwardedKitchenOrders = activeKitchenOrders.filter((order) => order.forwardedToDispatch === true);
  const completedKitchenOrders = kitchenOrders.filter((order) => order.status === "completada");

  const currentTab = ui.ordersTab || "activos";

  return `
    <div class="page-stack">
      ${renderFlash("orders")}
      ${renderFlash("kitchen-orders")}
      
      <!-- Pestañas de navegación -->
      <div class="tabs-container">
        <div class="tabs-list">
          <button 
            class="tab-btn ${currentTab === "activos" ? "active" : ""}" 
            data-action="set-orders-tab" 
            data-tab="activos"
          >
            📋 Pedidos Activos
          </button>
          <button 
            class="tab-btn ${currentTab === "historial" ? "active" : ""}" 
            data-action="set-orders-tab" 
            data-tab="historial"
          >
            📚 Historial
          </button>
          <!-- Botón de limpieza de emergencia -->
          <button 
            class="tab-btn" 
            style="background: var(--danger); color: white; margin-left: auto;"
            onclick="cleanSpecificOrders()"
          >
            🧹 Limpiar Pedidos
          </button>
          <!-- Botón para eliminar TODOS los pedidos -->
          <button 
            class="tab-btn" 
            style="background: var(--secondary); color: white;"
            onclick="clearAllActiveOrders()"
            title="Eliminar TODOS los pedidos activos"
          >
            🗑️ Eliminar Todo
          </button>
          <!-- Botón de eliminación forzada -->
          <button 
            class="tab-btn" 
            style="background: #dc3545; color: white;"
            onclick="forceDeleteSpecificOrder('kitchen-order-ec938096-ca63-4324-8695-de044acd26d5', 'REQ-2603231011-434')"
            title="Forzar eliminación del pedido problemático"
          >
            ⚡ Forzar Eliminar
          </button>
          <!-- Botones de diagnóstico Firebase -->
          <button 
            class="tab-btn" 
            style="background: var(--warning); color: white;"
            onclick="diagnoseFirebaseConnection()"
            title="Diagnóstico de conectividad Firebase"
          >
            🔍 Diagnóstico
          </button>
          <button 
            class="tab-btn" 
            style="background: var(--info); color: white;"
            onclick="forceReconnectFirebase()"
            title="Forzar reconexión a Firebase"
          >
            🔄 Reconectar
          </button>
        </div>
      </div>

      <!-- Contenido de la pestaña activa -->
      ${currentTab === "activos" ? `
        <section class="panel">
          ${
            activeKitchenOrders.length === 0
              ? renderEmptyState(
                  "No hay pedidos activos",
                  "Cuando una marca marque productos desde Sucursales, el pedido aparecera aqui automaticamente.",
                )
              : `
                <div class="section-heading">
                  <div>
                    <h2>Pedidos activos</h2>
                    <p>Aqui puedes ver cuantos pedidos operativos siguen abiertos dentro del modulo Pedidos.</p>
                  </div>
                </div>
                <div class="subtle-list">
                  <div class="subtle-item">
                    <span class="text-soft">Pedidos activos</span>
                    <strong>${activeKitchenOrders.length}</strong>
                  </div>
                  <div class="subtle-item">
                    <span class="text-soft">Pendientes</span>
                    <strong>${pendingKitchenOrders.length}</strong>
                  </div>
                  <div class="subtle-item">
                    <span class="text-soft">Enviados al encargado</span>
                    <strong>${forwardedKitchenOrders.length}</strong>
                  </div>
                </div>
              `
          }
        </section>
        ${
          orderPanels.length > 0
            ? `
              <section class="module-grid branch-grid">
                ${orderPanels.map((panel) => renderOrderPanelCard(panel)).join("")}
              </section>
            `
            : ""
        }
        ${
          kitchenOrders.length > 0
            ? `
              <section class="panel">
                <div class="section-heading">
                  <div>
                    <h2>Pedidos enviados</h2>
                    <p>Aqui aparecen los pedidos operativos ya preparados, con opcion de imprimirlos o enviarlos al encargado.</p>
                  </div>
                </div>
                ${renderKitchenOrdersList()}
              </section>
            `
            : ""
        }
      ` : ""}

      ${currentTab === "historial" ? `
        <section class="panel">
          <div class="section-heading">
            <div>
              <h2>Historial de pedidos</h2>
              <p>Aqui aparecen todos los pedidos completados o eliminados del sistema.</p>
            </div>
            <!-- Botón para limpiar todo el historial -->
            <button 
              class="btn btn-danger btn-small" 
              onclick="clearAllHistory()"
              title="Eliminar TODO el historial de pedidos"
            >
              🗑️ Limpiar Historial
            </button>
          </div>
          ${renderCompletedOrdersList(completedKitchenOrders)}
        </section>
      ` : ""}
    </div>
  `;
}

function renderCompletedOrdersList(completedOrders) {
  if (completedOrders.length === 0) {
    return renderEmptyState(
      "No hay pedidos en el historial",
      "Los pedidos completados o eliminados aparecerán aquí automáticamente."
    );
  }

  return `
    <div class="notification-list">
      ${completedOrders.map((order) => `
        <article class="notification-card" style="opacity: 0.8;">
          <div class="notification-head">
            <strong>Pedido ${escapeHtml(order.number)}</strong>
            <span class="status-chip status-completada">Completado</span>
          </div>
          <div class="notification-body">
            <p><strong>${escapeHtml(order.branchName)} / ${escapeHtml(order.brandName)}</p>
            <div class="notification-meta">
              <span class="pill">Fecha: ${escapeHtml(formatDate(order.date))}</span>
              <span class="pill">Solicitante: ${escapeHtml(order.requesterName || "Sin solicitante")}</span>
              <span class="pill">Autorizado por: ${escapeHtml(order.authorizedByName || "Sin autorización")}</span>
              <span class="pill">${order.items.length} productos</span>
              ${order.sentToBranch ? '<span class="pill">Enviado a sucursal</span>' : ''}
              ${order.completedAt ? `<span class="pill">Completado: ${escapeHtml(formatDate(order.completedAt))}</span>` : ''}
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Solicitado</th>
                    <th>Entregado</th>
                    <th>Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  ${order.items.map(item => `
                    <tr class="${item.unavailable ? 'producto-no-disponible' : ''}">
                      <td>${escapeHtml(item.productName)}</td>
                      <td>${escapeHtml(item.unit || "unid.")}</td>
                      <td>${formatNumber(item.requested)}</td>
                      <td>${formatNumber(item.delivered)}</td>
                      <td>${formatNumber(item.pending)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <p class="text-soft">
              ${order.sentToBranch 
                ? `Pedido enviado a sucursal y completado${order.completedBy ? ` por ${escapeHtml(order.completedBy)}` : ''}.`
                : `Pedido completado y procesado${order.completedBy ? ` por ${escapeHtml(order.completedBy)}` : ''}.`
              }
            </p>
          </div>
          <div class="notification-actions">
            <button class="btn btn-secondary btn-small" type="button" data-action="print-kitchen-order" data-id="${escapeHtml(order.id)}">
              Ver detalles
            </button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function legacyRenderOrderPanelCard(panel) {
  return `
    <article class="module-card branch-module-card">
      <div>
        <p class="eyebrow">${escapeHtml(panel.branchName)}</p>
        <h2>${escapeHtml(panel.brandName)}</h2>
        <p>Pedido consolidado desde los checkbox marcados por esta marca.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${panel.products.length} productos pedidos</span>
        <span class="pill">${escapeHtml(panel.updatedAtLabel)}</span>
      </div>
      <div class="tag-list">
        ${panel.products
          .map(
            (product) => `
              <span class="tag">${escapeHtml(product.name)} · tienda ${product.storeStock === null ? "sin stock" : `${formatNumber(product.storeStock)} ${escapeHtml(product.unit)}`}${product.shortage > 0 ? ` · faltan ${formatNumber(product.shortage)} ${escapeHtml(product.unit)}` : ""}</span>
            `,
          )
          .join("")}
      </div>
      <div class="actions-row">
        <button
          class="btn btn-primary"
          type="button"
          data-action="open-branch-brand"
          data-branch-id="${escapeHtml(panel.branchId)}"
          data-brand-name="${escapeHtml(panel.brandName)}"
        >
          Abrir marca
        </button>
      </div>
    </article>
  `;
}

function renderOrderPanelCard(panel) {
  return `
    <article class="module-card branch-module-card">
      <div>
        <p class="eyebrow">${escapeHtml(panel.branchName)}</p>
        <h2>${escapeHtml(panel.brandName)}</h2>
        <p>Pedido consolidado desde los checkbox marcados por esta marca.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${panel.products.length} productos pedidos</span>
        <span class="pill">${escapeHtml(panel.updatedAtLabel)}</span>
      </div>
      <div class="branch-checklist">
        ${panel.products
          .map(
            (product) => `
              <label class="branch-check-item">
                <input
                  type="checkbox"
                  data-order-send="true"
                  data-branch-id="${escapeHtml(panel.branchId)}"
                  data-brand-name="${escapeHtml(panel.brandName)}"
                  data-product-id="${escapeHtml(product.id)}"
                />
                <span class="branch-check-copy">
                  <strong>${escapeHtml(product.name)}</strong>
                  <small><strong>Enviar a Pedidos enviados:</strong> marca esta casilla para preparar el pedido operativo.</small>
                  ${
                    product.dailyQuantity !== null && product.dailyQuantity > 0
                      ? `<small>Cantidad actual: ${formatNumber(product.dailyQuantity)} ${escapeHtml(product.unit)}</small>`
                      : ""
                  }
                  <small>Tienda: ${
                    product.storeStock === null
                      ? "sin stock registrado"
                      : `${formatNumber(product.storeStock)} ${escapeHtml(product.unit)}`
                  }</small>
                  <small class="${product.orderQuantity > 0 ? "stock-shortage-copy" : ""}">
                    ${
                      product.orderQuantity > 0
                          ? `Se pediran ${formatNumber(product.orderQuantity)} ${escapeHtml(product.unit)} para completar.`
                        : "Solo se enviara si realmente falta mercancia en tienda."
                    }
                  </small>
                </span>
              </label>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function getOrdersReadyForDispatch() {
  return getSortedKitchenOrders().filter(
    (order) => order.forwardedToDispatch === true && order.status !== "completada",
  );
}

function defaultBranchStorage() {
  return BRANCH_LOCATIONS.map((branch) => ({
    branchId: branch.id,
    stockByProductId: {},
    updatedAt: "",
  }));
}

function defaultBranchConsumption() {
  return BRANCH_LOCATIONS.map((branch) => ({
    branchId: branch.id,
    consumptionByProductId: {},
    updatedAt: "",
  }));
}

function defaultBranchDailyQuantities() {
  return BRANCH_LOCATIONS.map((branch) => ({
    branchId: branch.id,
    dailyQuantityByProductId: {},
    updatedAt: "",
  }));
}

function renderDispatchQueueCard(order) {
  return `
    <article class="notification-card">
      <div class="notification-head">
        <strong>Pedido ${escapeHtml(order.number)}</strong>
        <span class="status-chip status-en_progreso">Listo para salida</span>
      </div>
      <div class="notification-body">
        <p><strong>${escapeHtml(order.branchName)} / ${escapeHtml(order.brandName)}</strong></p>
        <div class="notification-meta">
          <span class="pill">Fecha: ${escapeHtml(formatDate(order.date))}</span>
          <span class="pill">Solicitante: ${escapeHtml(order.requesterName || "Sin solicitante")}</span>
          <span class="pill">Autorizado por: ${escapeHtml(order.authorizedByName || "Sin autorizacion")}</span>
          <span class="pill">${order.items.length} productos</span>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Unidad</th>
                <th>Solicitado</th>
                <th>Entregado</th>
                <th>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              ${order.items
                .map(
                  (item) => `
                    <tr class="${item.workedInKitchen ? "order-item-worked blink-success" : ""}">
                      <td>${escapeHtml(item.productName)}</td>
                      <td>${escapeHtml(item.unit || "unid.")}</td>
                      <td>${formatNumber(item.requested)}</td>
                      <td>${formatNumber(item.delivered)}</td>
                      <td>${formatNumber(item.pending)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="text-soft">Al dar salida, el sistema descuenta inventario automaticamente y envia a Cocina solo el faltante consolidado por producto.</p>
      </div>
      <div class="notification-actions">
        <button
          class="btn btn-info btn-small"
          type="button"
          data-action="view-order"
          data-id="${escapeHtml(order.id)}"
        >
          Ver pedido
        </button>
        <button
          class="btn btn-primary btn-small"
          type="button"
          data-action="dispatch-kitchen-order"
          data-id="${escapeHtml(order.id)}"
        >
          Dar salida
        </button>
        <button
          class="btn btn-secondary btn-small"
          type="button"
          data-action="print-kitchen-order"
          data-id="${escapeHtml(order.id)}"
        >
          Imprimir pedido
        </button>
      </div>
    </article>
  `;
}

function renderDispatchQueueList() {
  const orders = getOrdersReadyForDispatch();

  if (orders.length === 0) {
    return renderEmptyState(
      "No hay pedidos pendientes de salida",
      "Cuando envies un pedido al encargado desde Pedidos, aparecera aqui listo para despacharse.",
    );
  }

  return `
    <div class="notification-list">
      ${orders.map((order) => renderDispatchQueueCard(order)).join("")}
    </div>
  `;
}

function renderBranchesModule() {
  const products = getSortedProducts();
  const accessibleBranches = getAccessibleBranches();
  const selectedBranch = canAccessBranch(ui.selectedBranchId) ? getBranchLocationById(ui.selectedBranchId) : null;
  const selectedBranchStorage = ui.selectedBranchStorage === true;
  const selectedBrand = normalizeBranchBrand(ui.selectedBranchBrand);

  if (!selectedBranch) {
    return `
      <div class="page-stack">
        ${renderFlash("branches")}
        <section class="module-grid centered-home-grid">
          ${accessibleBranches.map((branch) => renderBranchLandingCard(branch)).join("")}
        </section>
      </div>
    `;
  }

  if (selectedBranchStorage) {
    return renderBranchStorageProducts(selectedBranch, products);
  }

  if (!selectedBrand) {
    return `
      <div class="page-stack">
        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Sucursal</p>
              <h2>${escapeHtml(selectedBranch.name)}</h2>
              <p>Selecciona una marca para ver sus productos o abre Almacén para registrar el stock real de tienda de esta sucursal.</p>
            </div>
            <div class="actions-row">
              <button class="btn btn-ghost" type="button" data-action="back-to-branches">Volver a sucursales</button>
            </div>
          </div>
        </section>
        ${renderFlash("branches")}
        <section class="module-grid centered-home-grid">
          ${BRANCH_BRANDS.map((brandName) => renderBranchBrandCard(selectedBranch, brandName, products)).join("")}
          ${renderBranchStorageCard(selectedBranch, products)}
        </section>
      </div>
    `;
  }

  return renderBranchBrandProducts(selectedBranch, selectedBrand, products);
}

function renderBranchLandingCard(branch) {
  const requestedCount = getBranchRequestedProductsCount(branch.id);
  const activeBrands = getBranchActiveBrandCount(branch.id);

  return `
    <article class="module-card home-module-card">
      <div>
        <p class="eyebrow">Sucursal</p>
        <h2>${escapeHtml(branch.name)}</h2>
        <p>Entra a esta sucursal para abrir sus marcas y luego marcar los productos que necesita.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${BRANCH_BRANDS.length} marcas</span>
        <span class="pill">${requestedCount} productos solicitados</span>
        <span class="pill">${activeBrands} marcas activas</span>
      </div>
      <button class="btn btn-primary" type="button" data-action="open-branch" data-branch-id="${escapeHtml(branch.id)}">
        Abrir ${escapeHtml(branch.name)}
      </button>
    </article>
  `;
}

function renderBranchBrandCard(branch, brandName, products) {
  const visibleProducts = getBranchBrandVisibleProducts(branch.id, brandName, products);
  const record = getBranchNeedRecord(branch.id, brandName);
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const selectedCount = getRequestableBranchProductIds(record).filter((productId) =>
    visibleProductIds.has(productId),
  ).length;
  const lastUpdateLabel =
    selectedCount > 0 && record.updatedAt
      ? `Actualizado ${formatDateTime(record.updatedAt)}`
      : "Sin pedidos activos";

  return `
    <article class="module-card home-module-card">
      <div>
        <p class="eyebrow">${escapeHtml(branch.name)}</p>
        <h2>${escapeHtml(brandName)}</h2>
        <p>Abre esta marca para ver el listado de productos disponibles y marcar lo que necesita.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${visibleProducts.length} productos visibles</span>
        <span class="pill">${selectedCount} solicitados</span>
        <span class="pill">${escapeHtml(lastUpdateLabel)}</span>
      </div>
      <button
        class="btn btn-primary"
        type="button"
        data-action="open-branch-brand"
        data-branch-id="${escapeHtml(branch.id)}"
        data-brand-name="${escapeHtml(brandName)}"
      >
        Abrir ${escapeHtml(brandName)}
      </button>
    </article>
  `;
}

function renderBranchStorageCard(branch, products) {
  const stats = getBranchStorageCardStats(branch.id, products);

  return `
    <article class="module-card home-module-card">
      <div>
        <p class="eyebrow">${escapeHtml(branch.name)}</p>
        <h2>Almacén</h2>
        <p>Abre este módulo para registrar y visualizar el stock real de tienda de esta sucursal.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${stats.total} productos</span>
        <span class="pill">${stats.withStock} con stock</span>
        <span class="pill">${stats.pending} pendientes</span>
      </div>
      <button
        class="btn btn-primary"
        type="button"
        data-action="open-branch-storage"
        data-branch-id="${escapeHtml(branch.id)}"
      >
        Abrir Almacén
      </button>
    </article>
  `;
}

function renderBranchBrandProducts(branch, brandName, products) {
  const visibleProducts = getBranchBrandVisibleProducts(branch.id, brandName, products);
  const record = getBranchNeedRecord(branch.id, brandName);
  const selectedProductIds = new Set(getRequestableBranchProductIds(record));
  const canEditDailyQuantity = canEditBranchStoreStock(branch.id);
  const stockEditorMessage =
    "El stock real y el consumo de tienda se gestionan desde Almacen. Aqui puedes registrar lo que queda hoy en tienda para esta marca y marcar lo que necesita.";

  return `
    <div class="page-stack">
      <section class="panel branch-banner-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Sucursal y marca</p>
            <h2>${escapeHtml(branch.name)} · ${escapeHtml(brandName)}</h2>
            <p>Aqui se muestran los productos disponibles. Marca solo los que esta marca necesita.</p>
          </div>
          <div class="actions-row">
            <button class="btn btn-ghost" type="button" data-action="back-to-branch-brands">Volver a marcas</button>
            <button class="btn btn-ghost" type="button" data-action="back-to-branches">Volver a sucursales</button>
          </div>
        </div>
      </section>
      ${
        products.length === 0
          ? `
            <section class="panel">
              <div class="empty-state">
                <h3>No hay productos registrados todavia</h3>
                <p>Cuando crees productos en Cuarto Frio, esta marca podra marcarlos aqui automaticamente.</p>
              </div>
            </section>
          `
          : visibleProducts.length === 0
            ? `
              <section class="panel">
                <div class="empty-state">
                  <h3>Esta marca todavia no tiene productos asignados</h3>
                  <p>Abre Almacen y usa los botones Green Salad o La Pasta para enviar productos a esta marca.</p>
                </div>
              </section>
            `
            : `
              <section class="panel">
                <div class="section-heading">
                  <div>
                    <h2>Productos disponibles</h2>
                    <p>Estos productos vienen de Cuarto Frio. Marca aqui lo que esta marca necesita para generar el pedido.</p>
                  </div>
                </div>
                ${renderFlash("branches")}
                <div class="feedback info">
                  ${escapeHtml(stockEditorMessage)}
                </div>
                <div class="branch-checklist">
                  ${visibleProducts
                    .map((product) => {
                      const selected = selectedProductIds.has(product.id);
                      const dailyQuantity = getBranchProductDailyQuantity(branch.id, product.id);
                      const requestBase = getBranchProductRequestBase(branch.id, product);
                      const orderQuantity = getBranchProductOrderQuantity(record, product);
                      const dailyQuantityFieldId = `branch-daily-${branch.id}-${slugify(brandName)}-${product.id}`;

                      return `
                        <div class="branch-check-item ${selected ? "checked" : ""}">
                          <label class="branch-check-main">
                            <input
                              type="checkbox"
                              data-branch-id="${escapeHtml(branch.id)}"
                              data-brand-name="${escapeHtml(brandName)}"
                              data-product-id="${escapeHtml(product.id)}"
                              ${selected ? "checked" : ""}
                            />
                            <span class="branch-check-copy">
                            <strong>${escapeHtml(product.name)}</strong>
                            <small>${escapeHtml(formatBranchProductMeta(product))}</small>
                            <small>
                              ${
                                dailyQuantity !== null
                                  ? `Cantidad actual: ${formatNumber(dailyQuantity)} ${escapeHtml(product.unit)}`
                                  : "Cantidad actual: sin registrar"
                              }
                            </small>
                            <small>
                              ${
                                requestBase > 0
                                    ? `Tienda: ${formatNumber(requestBase)} ${escapeHtml(product.unit)} &middot; Abastecido`
                                    : "Tienda: sin stock registrado"
                                }
                              </small>
                            <small class="${orderQuantity > 0 ? "stock-shortage-copy" : ""}">
                              ${
                                orderQuantity > 0
                                  ? `Se pediran ${formatNumber(orderQuantity)} ${escapeHtml(product.unit)} para completar tienda.`
                                  : "No hace falta pedir este producto ahora."
                              }
                            </small>
                            </span>
                          </label>
                          <div class="branch-stock-field">
                            <label for="${escapeHtml(dailyQuantityFieldId)}">Cantidad actual</label>
                            <input
                              id="${escapeHtml(dailyQuantityFieldId)}"
                              type="number"
                              step="0.01"
                              min="0"
                              inputmode="decimal"
                              placeholder="0"
                              value="${dailyQuantity !== null ? escapeHtml(String(dailyQuantity)) : ""}"
                              data-branch-daily-quantity-input="true"
                              data-branch-id="${escapeHtml(branch.id)}"
                              data-product-id="${escapeHtml(product.id)}"
                              ${canEditDailyQuantity ? "" : "disabled"}
                            />
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              </section>
            `
      }
    </div>
  `;
}
function renderColdRoomModule() {
  return `
    <div class="page-stack">
      <nav class="tab-strip" aria-label="Secciones de Cuarto Frío">
        ${renderColdRoomTab("equipo", "Equipo")}
        ${renderColdRoomTab("productos", "Productos")}
        ${renderColdRoomTab("entrada", "Entrada a Cuarto Frío")}
        ${renderColdRoomTab("salida", "Salida de Productos")}
        ${renderColdRoomTab("control", "Panel de Control")}
        ${renderColdRoomTab("historial", "Historial")}
        ${renderColdRoomTab("notificaciones", "Notificaciones")}
      </nav>

      ${renderColdRoomSection()}
    </div>
  `;
}

function renderColdRoomTab(section, label) {
  return `
    <button
      class="tab-btn ${ui.coldRoomSection === section ? "active" : ""}"
      data-action="set-cold-section"
      data-section="${section}"
    >
      ${label}
    </button>
  `;
}

function renderColdRoomSection() {
  switch (ui.coldRoomSection) {
    case "productos":
      return renderProductsSection();
    case "entrada":
      return renderEntrySection();
    case "salida":
      return renderExitSection();
    case "control":
      return renderControlSection();
    case "historial":
      return renderHistorySection();
    case "notificaciones":
      return renderNotificationsSection();
    case "equipo":
    default:
      return renderTeamSection();
  }
}

function renderTeamSection() {
  const editingCollaborator = ui.editingCollaboratorId
    ? getCollaboratorById(ui.editingCollaboratorId)
    : null;
  const collaborators = getSortedCollaborators();
  const assignmentCollaborators = collaborators.filter(
    (collaborator) =>
      collaborator.status === "active" &&
      normalizeCollaboratorRole(collaborator.area) === "cocinero",
  );
  const assignments = getEnrichedAssignments();
  const hasProducts = state.products.length > 0;
  const onlineCollaborators = getOnlineCollaborators();
  const pendingAssignmentProduct = ui.pendingAssignmentProductId
    ? getProductById(ui.pendingAssignmentProductId)
    : null;

  return `
    <div class="page-stack">
      <section class="split-grid">
        <article class="panel" id="collaborator-form-card">
          <div class="section-heading">
            <div>
              <h2>Equipo</h2>
              <p>Registra colaboradores del área y mantenlos conectados con la producción de productos ya existentes.</p>
            </div>
          </div>
          ${renderFlash("team")}
          <form id="collaborator-form" class="form-grid">
            <div class="field">
              <label for="collaborator-name">Nombre</label>
              <input
                id="collaborator-name"
                name="name"
                type="text"
                value="${escapeHtml(editingCollaborator?.name || "")}"
                placeholder="Ej. Ana Pérez"
                required
              />
            </div>
            <div class="field">
              <label for="collaborator-area">Área o función</label>
              <input
                id="collaborator-area"
                name="area"
                type="text"
                value="${escapeHtml(editingCollaborator?.area || "")}"
                placeholder="Ej. Producción de ensaladas"
              />
            </div>
            <div class="field">
              <label for="collaborator-status">Estado</label>
              <select id="collaborator-status" name="status">
                <option value="active" ${editingCollaborator?.status !== "inactive" ? "selected" : ""}>Activo</option>
                <option value="inactive" ${editingCollaborator?.status === "inactive" ? "selected" : ""}>Inactivo</option>
              </select>
            </div>
            <div class="field full-span">
              <div class="actions-row">
                <button class="btn btn-primary" type="submit">
                  ${editingCollaborator ? "Guardar cambios" : "Añadir colaborador"}
                </button>
                ${
                  editingCollaborator
                    ? '<button class="btn btn-ghost" type="button" data-action="cancel-collaborator-edit">Cancelar edición</button>'
                    : ""
                }
              </div>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Asignarle producción</h2>
              <p>Solo puedes asignar producción usando productos ya registrados. Esa relación alimenta la vista de Cocina y las notificaciones.</p>
            </div>
          </div>
          ${renderFlash("assignment")}
          <form id="assignment-form" class="form-grid">
            <div class="field">
              <label for="assignment-collaborator">Colaborador</label>
              <select id="assignment-collaborator" name="collaboratorId" ${assignmentCollaborators.length === 0 ? "disabled" : ""}>
                <option value="">Selecciona un colaborador</option>
                ${assignmentCollaborators
                  .map(
                    (collaborator) => `
                      <option value="${escapeHtml(collaborator.id)}">${escapeHtml(collaborator.name)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="assignment-product">Producto vinculado</label>
              <select id="assignment-product" name="productId" ${hasProducts ? "" : "disabled"}>
                <option value="">Selecciona un producto</option>
                ${getSortedProducts()
                  .map(
                    (product) => `
                      <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(product.unit)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="assignment-quantity">Cantidad objetivo (stock ideal)</label>
              <input
                id="assignment-quantity"
                name="targetQuantity"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Se completa automáticamente"
                readonly
                required
              />
            </div>
            <div class="field">
              <label for="assignment-note">Observación</label>
              <input
                id="assignment-note"
                name="note"
                type="text"
                placeholder="Ej. Prioridad mañana"
              />
            </div>
            <div class="field full-span">
              <button class="btn btn-primary" type="submit">Vincular producción</button>
            </div>
          </form>
          <p class="helper-text">
            ${
              hasProducts
                ? "Cada asignación une colaborador y producto. La cantidad objetivo se toma automáticamente del stock ideal del producto."
                : "Primero registra productos para poder asignar producción al equipo."
            }
          </p>
          <p class="helper-text">
            ${
              assignmentCollaborators.length > 0
                ? "En esta lista solo aparecen colaboradores activos con rol Cocinero."
                : "No hay Cocineros activos disponibles para asignar producción."
            }
          </p>
          ${
            pendingAssignmentProduct
              ? `<p class="field-hint">Producto listo para produccion: ${escapeHtml(pendingAssignmentProduct.name)}.</p>`
              : ""
          }
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Lista de colaboradores</h2>
            <p>Cada colaborador puede reflejar sus productos vinculados. Esa misma información aparece en Cocina sin volver a escribirla.</p>
          </div>
        </div>
        ${
          onlineCollaborators.length > 0
            ? `
              <div class="feedback success blink-online">
                Usuarios en linea: ${escapeHtml(onlineCollaborators.map((collaborator) => collaborator.name).join(", "))}
              </div>
            `
            : ""
        }
        ${
          collaborators.length === 0
            ? renderEmptyState(
                "Aún no hay colaboradores",
                "Registra el primer integrante del equipo para empezar a asignarle producción y enlazarlo con Cocina.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Área o función</th>
                      <th>Sucursal</th>
                      <th>Estado</th>
                      <th>Producción vinculada</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${collaborators
                      .map((collaborator) => {
                        const linkedAssignments = getAssignmentsForCollaborator(collaborator.id);
                        const online = isCollaboratorOnline(collaborator.id);
                        return `
                          <tr class="${online ? "live-user-row" : ""}">
                            <td>
                              <div class="collaborator-name-cell">
                                <strong>${escapeHtml(collaborator.name)}</strong>
                                ${renderCollaboratorPresenceChip(collaborator.id)}
                              </div>
                            </td>
                            <td>${escapeHtml(formatCollaboratorRole(collaborator.area))}</td>
                            <td>${escapeHtml(collaborator.branch || "Sin sucursal")}</td>
                            <td>
                              <div class="status-stack">
                                ${renderStatusChip(collaborator.status)}
                                ${online ? '<span class="status-chip status-online blink-online">En linea</span>' : ""}
                              </div>
                            </td>
                            <td>
                              ${
                                linkedAssignments.length === 0
                                  ? '<span class="text-soft">Sin producción asignada</span>'
                                  : `<div class="tag-list">${linkedAssignments
                                      .map(
                                        (assignment) => `
                                          <span class="tag">${escapeHtml(assignment.productName)} · ${formatNumber(assignment.targetQuantity)} ${escapeHtml(assignment.unit)}</span>
                                        `,
                                      )
                                      .join("")}</div>`
                              }
                            </td>
                            <td>
                              <div class="actions-row">
                                <button class="btn btn-ghost btn-small" type="button" data-action="open-collaborator-password" data-id="${escapeHtml(collaborator.id)}" aria-label="Ver contrasena actual" title="Ver contrasena actual">&#128065;</button>
                                <button class="btn btn-secondary btn-small" type="button" data-action="edit-collaborator" data-id="${escapeHtml(collaborator.id)}">Editar</button>
                                <button class="btn btn-danger btn-small" type="button" data-action="delete-collaborator" data-id="${escapeHtml(collaborator.id)}">Eliminar</button>
                              </div>
                            </td>
                          </tr>
                        `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Producción asignada</h2>
            <p>Relación directa entre colaboradores y productos. Estas asignaciones se usan para identificar reposiciones en Cocina.</p>
          </div>
        </div>
        ${
          assignments.length === 0
            ? renderEmptyState(
                "Sin asignaciones activas",
                "Cuando vincules un colaborador con un producto, aparecerá aquí y también se usará en las notificaciones de reposición.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Producto</th>
                      <th>Cantidad objetivo</th>
                      <th>Nota</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${assignments
                      .map(
                        (assignment) => `
                          <tr>
                            <td>${escapeHtml(assignment.collaboratorName)}</td>
                            <td>${escapeHtml(assignment.productName)}</td>
                            <td>${formatNumber(assignment.targetQuantity)} ${escapeHtml(assignment.unit)}</td>
                            <td>${escapeHtml(assignment.note || "Sin observación")}</td>
                            <td>
                              <button class="btn btn-danger btn-small" type="button" data-action="delete-assignment" data-id="${escapeHtml(assignment.id)}">Eliminar</button>
                            </td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderProductsSection() {
  const editingProduct = ui.editingProductId ? getProductById(ui.editingProductId) : null;
  const filteredProducts = getFilteredProducts();

  return `
    <div class="page-stack">
      <section class="split-grid">
        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Productos</h2>
              <p>Registra la base del sistema. Todo lo que entre, salga, se asigne o notifique debe partir desde aquí.</p>
            </div>
          </div>
          ${renderFlash("products")}
          <form id="product-form" class="form-grid">
            <div class="field">
              <label for="product-name">Nombre del producto</label>
              <input
                id="product-name"
                name="name"
                type="text"
                value="${escapeHtml(editingProduct?.name || "")}"
                placeholder="Ej. Lechuga romana"
                list="product-name-suggestions"
                autocomplete="off"
                required
              />
              <small class="field-hint" data-product-match-hint>
                ${
                  ui.productMatchId && !editingProduct
                    ? "Producto encontrado en almacen. Puedes actualizar sus datos sin volver a escribir todo."
                    : "Si escribes un nombre ya registrado, el sistema completara sus datos automaticamente."
                }
              </small>
            </div>
            <div class="field">
              <label for="product-unit">Unidad de medida</label>
              <input
                id="product-unit"
                name="unit"
                type="text"
                value="${escapeHtml(PRODUCT_DEFAULT_UNIT)}"
                readonly
                required
              />
            </div>
            <div class="field">
              <label for="product-stock-current">Stock actual</label>
              <input
                id="product-stock-current"
                name="stockCurrent"
                type="number"
                step="0.01"
                min="0"
                value="${editingProduct ? escapeHtml(String(editingProduct.stockCurrent)) : "0"}"
                required
              />
            </div>
            <div class="field">
              <label for="product-stock-ideal">Stock ideal</label>
              <input
                id="product-stock-ideal"
                name="stockIdeal"
                type="number"
                step="0.01"
                min="0"
                value="${editingProduct ? escapeHtml(String(editingProduct.stockIdeal)) : "0"}"
                required
              />
            </div>
            <div class="field full-span">
              <div class="actions-row">
                <button class="btn btn-primary" type="submit">
                  ${editingProduct ? "Guardar cambios" : "Registrar producto"}
                </button>
                ${
                  editingProduct
                    ? '<button class="btn btn-ghost" type="button" data-action="cancel-product-edit">Cancelar edición</button>'
                    : ""
                }
              </div>
            </div>
          </form>
          <datalist id="product-name-suggestions">
            ${getSortedProducts()
              .map(
                (product) => `
                  <option value="${escapeHtml(product.name)}"></option>
                `,
              )
              .join("")}
          </datalist>
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Buscar producto</h2>
              <p>Filtra por nombre, unidad, categoría o estado para encontrar rápidamente lo que necesitas.</p>
            </div>
          </div>
          <form id="product-search-form" class="form-grid">
            <div class="field full-span">
              <label for="product-search">Buscar</label>
              <input
                id="product-search"
                name="productSearch"
                type="text"
                value="${escapeHtml(ui.productSearch)}"
                placeholder="Ej. lechuga, kg, activo"
              />
            </div>
            <div class="field full-span">
              <div class="actions-row">
                <button class="btn btn-primary" type="submit">Aplicar búsqueda</button>
                <button class="btn btn-ghost" type="button" data-action="clear-product-search">Limpiar</button>
              </div>
            </div>
          </form>

          <div class="subtle-list">
            <div class="subtle-item">
              <span class="text-soft">Productos visibles</span>
              <strong>${filteredProducts.length}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Con producción asignada</span>
              <strong>${getProductsWithAssignmentsCount()}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Debajo del stock ideal</span>
              <strong>${getLowStockProducts().length}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Listado general</h2>
            <p>Los productos creados aquí alimentan asignación de producción, entradas, salidas, historial y notificaciones.</p>
          </div>
        </div>
        ${
          filteredProducts.length === 0
            ? renderEmptyState(
                "No hay productos para mostrar",
                ui.productSearch
                  ? "Prueba con otro término o limpia la búsqueda."
                  : "Registra el primer producto para habilitar entradas, salidas y asignación de producción.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Unidad</th>
                      <th>Categoría</th>
                      <th>Stock actual</th>
                      <th>Stock ideal</th>
                      <th>Estado</th>
                      <th>Equipo vinculado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredProducts
                      .map((product) => {
                        const linkedCollaborators = getAssignmentsForProduct(product.id);
                        const lowStock = isProductLowStock(product);
                        return `
                          <tr class="${lowStock ? "low-stock-row" : ""}">
                            <td><strong>${escapeHtml(product.name)}</strong></td>
                            <td>${escapeHtml(product.unit)}</td>
                            <td>${escapeHtml(product.category || "Sin categoría")}</td>
                            <td>${formatNumber(product.stockCurrent)} ${escapeHtml(product.unit)}</td>
                            <td>${formatNumber(product.stockIdeal)} ${escapeHtml(product.unit)}</td>
                            <td>${renderProductStatus(product)}</td>
                            <td>
                              ${
                                linkedCollaborators.length === 0
                                  ? '<span class="text-soft">Sin asignaciones</span>'
                                  : `<div class="tag-list">${linkedCollaborators
                                      .map(
                                        (assignment) => `
                                          <span class="tag">${escapeHtml(assignment.collaboratorName)}</span>
                                        `,
                                      )
                                      .join("")}</div>`
                              }
                            </td>
                            <td>
                              <div class="actions-row">
                                <button class="btn btn-secondary btn-small" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}">Editar</button>
                                <button class="btn btn-danger btn-small" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}">Eliminar</button>
                              </div>
                            </td>
                          </tr>
                        `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderEntrySection() {
  const recentEntries = getRecentHistoryByType("entrada");

  return `
    <div class="page-stack">
      <section class="split-grid">
        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Entrada a Cuarto Frío</h2>
              <p>Registra lo que entra al inventario y actualiza automáticamente el stock actual del producto vinculado.</p>
            </div>
          </div>
          ${renderFlash("entry")}
          <form id="entry-form" class="form-grid">
            <div class="field">
              <label for="entry-product">Producto</label>
              <select id="entry-product" name="productId" ${state.products.length === 0 ? "disabled" : ""} required>
                <option value="">Selecciona un producto</option>
                ${getSortedProducts()
                  .map(
                    (product) => `
                      <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${formatNumber(product.stockCurrent)} ${escapeHtml(product.unit)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="entry-quantity">Cantidad</label>
              <input id="entry-quantity" name="quantity" type="number" step="0.01" min="0.01" required />
            </div>
            <div class="field">
              <label for="entry-stock-ideal">Stock ideal</label>
              <input id="entry-stock-ideal" name="stockIdeal" type="number" step="0.01" min="0" required />
            </div>
            <div class="field">
              <label for="entry-date">Fecha</label>
              <input id="entry-date" name="date" type="date" value="${today()}" required />
            </div>
            <div class="field">
              <label for="entry-collaborator">Colaborador responsable</label>
              <select id="entry-collaborator" name="collaboratorId">
                <option value="">Opcional</option>
                ${getSortedCollaborators()
                  .map(
                    (collaborator) => `
                      <option value="${escapeHtml(collaborator.id)}">${escapeHtml(collaborator.name)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field full-span">
              <label for="entry-observation">Observación</label>
              <textarea id="entry-observation" name="observation" placeholder="Opcional"></textarea>
            </div>
            <div class="field full-span">
              <button class="btn btn-primary" type="submit">Registrar entrada</button>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Inventario en tiempo real</h2>
              <p>Vista rápida de productos con menor margen respecto al stock ideal.</p>
            </div>
          </div>
          <div class="inventory-highlight">
            ${
              state.products.length === 0
                ? renderEmptyState(
                    "Aún no hay productos",
                    "Registra productos antes de cargar entradas al inventario.",
                  )
                : getInventoryHighlights()
            }
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Últimas entradas</h2>
            <p>Cada registro queda guardado en historial con producto, cantidad, fecha y colaborador relacionado.</p>
          </div>
          ${renderHistoryDeleteButton("entry", recentEntries.length > 0)}
        </div>
        ${
          recentEntries.length === 0
            ? renderEmptyState(
                "No hay entradas registradas",
                "Cuando registres una entrada, aparecerá aquí y también en el historial general.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Colaborador</th>
                      <th>Stock después</th>
                      <th>Observación</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recentEntries
                      .map(
                        (record) => `
                          <tr>
                            <td>${escapeHtml(formatDate(record.date))}</td>
                            <td>${escapeHtml(record.productName)}</td>
                            <td>${formatNumber(record.quantity)} ${escapeHtml(record.unit)}</td>
                            <td>${escapeHtml(record.collaboratorName || "Sin colaborador")}</td>
                            <td>${formatNumber(record.stockAfter)} ${escapeHtml(record.unit)}</td>
                            <td>${escapeHtml(record.observation || "Sin observación")}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderExitSection() {
  const recentExits = getRecentHistoryByType("salida");
  const exitDraft = ui.exitDraft || {};
  const ordersReadyForDispatch = getOrdersReadyForDispatch();

  return `
    <div class="page-stack">
      <section class="split-grid">
        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Salida de Productos</h2>
              <p>Descuenta stock automáticamente, valida disponibilidad y genera una notificación en Cocina para reponer.</p>
            </div>
          </div>
          ${renderFlash("exit")}
          <form id="exit-form" class="form-grid">
            <div class="field">
              <label for="exit-product">Producto</label>
              <select id="exit-product" name="productId" ${state.products.length === 0 ? "disabled" : ""} required>
                <option value="">Selecciona un producto</option>
                ${getSortedProducts()
                  .map((product) => {
                    const selected = exitDraft.productId === product.id ? "selected" : "";
                    return `
                      <option value="${escapeHtml(product.id)}" ${selected}>${escapeHtml(product.name)} · disponible ${formatNumber(product.stockCurrent)} ${escapeHtml(product.unit)}</option>
                    `;
                  })
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="exit-quantity">Cantidad saliente</label>
              <input id="exit-quantity" name="quantity" type="number" step="0.01" min="0.01" value="${escapeHtml(exitDraft.quantity || "")}" required />
            </div>
            <div class="field">
              <label for="exit-destination">Sucursal destino</label>
              <select id="exit-destination" name="destination" required>
                <option value="">Selecciona una sucursal</option>
                ${renderDestinationOptions(exitDraft.destination)}
              </select>
            </div>
            <div class="field">
              <label for="exit-date">Fecha</label>
              <input id="exit-date" name="date" type="date" value="${escapeHtml(exitDraft.date || today())}" required />
            </div>
            <div class="field full-span">
              <label for="exit-observation">Observación</label>
              <textarea id="exit-observation" name="observation" placeholder="Opcional">${escapeHtml(exitDraft.observation || "")}</textarea>
            </div>
            <div class="field full-span">
              <button class="btn btn-primary" type="submit">Registrar salida</button>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Cómo se conecta con Cocina</h2>
              <p>Cada salida crea una tarea de reposición visible en Cocina con producto, cantidad, fecha, destino y colaboradores asignados si existen.</p>
            </div>
          </div>
          ${renderFlash("dispatch-queue")}
          ${
            ordersReadyForDispatch.length === 0
              ? `
                <div class="empty-state">
                  <h3>No hay pedidos pendientes de salida</h3>
                  <p>Cuando envíes un pedido al encargado desde Pedidos, aparecerá aquí listo para despacharse.</p>
                </div>
              `
              : renderDispatchQueueList()
          }
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Últimas salidas</h2>
            <p>Cada salida queda registrada en historial y enlaza la notificación enviada a Cocina.</p>
          </div>
          ${renderHistoryDeleteButton("exit", recentExits.length > 0)}
        </div>
        ${
          recentExits.length === 0
            ? renderEmptyState(
                "No hay salidas registradas",
                "Cuando registres una salida, aparecerá aquí con su sucursal destino y la notificación generada.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Sucursal destino</th>
                      <th>Despachado por</th>
                      <th>Notificación</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recentExits
                      .map(
                        (record) => `
                          <tr>
                            <td>${escapeHtml(formatDate(record.date))}</td>
                            <td>${escapeHtml(record.productName)}</td>
                            <td>${formatNumber(record.quantity)} ${escapeHtml(record.unit)}</td>
                            <td>${escapeHtml(record.destination)}</td>
                            <td>${escapeHtml(record.collaboratorName)}</td>
                            <td>${escapeHtml(record.notificationMessage || "Sin notificación")}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderHistorySection() {
  const filteredHistory = getFilteredHistory();

  return `
    <div class="page-stack">
      <section class="split-grid">
        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Historial general</h2>
              <p>Consulta entradas, salidas, producto relacionado, colaborador, fecha, cantidad, destino y la notificación generada cuando aplica.</p>
            </div>
          </div>
          ${renderFlash("history")}
          <form id="history-filter-form" class="form-grid">
            <div class="field">
              <label for="history-search">Buscar por fecha, nombre, producto, cantidad o colaborador</label>
              <input
                id="history-search"
                name="historySearch"
                type="text"
                value="${escapeHtml(ui.historySearch)}"
                placeholder="Ej. Ana, lechuga, 12, Venezuela"
              />
            </div>
            <div class="field">
              <label for="history-date">Fecha exacta</label>
              <input id="history-date" name="historyDate" type="date" value="${escapeHtml(ui.historyDate)}" />
            </div>
            <div class="field full-span">
              <div class="actions-row">
                <button class="btn btn-primary" type="submit">Aplicar filtros</button>
                <button class="btn btn-ghost" type="button" data-action="clear-history-filters">Limpiar</button>
              </div>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Resumen operativo</h2>
              <p>Vista rápida de movimientos acumulados y tareas registradas dentro del historial.</p>
            </div>
          </div>
          <div class="subtle-list">
            <div class="subtle-item">
              <span class="text-soft">Movimientos totales</span>
              <strong>${state.history.length}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Entradas</span>
              <strong>${state.history.filter((record) => record.type === "entrada").length}</strong>
            </div>
            <div class="subtle-item">
              <span class="text-soft">Salidas</span>
              <strong>${state.history.filter((record) => record.type === "salida").length}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Movimientos guardados</h2>
            <p>Todo queda vinculado y consultable desde un solo punto.</p>
          </div>
          ${renderHistoryDeleteButton("history", state.history.length > 0)}
        </div>
        ${
          filteredHistory.length === 0
            ? renderEmptyState(
                "No hay registros para mostrar",
                state.history.length === 0
                  ? "Los movimientos empezarán a guardarse aquí cuando registres entradas o salidas."
                  : "Ningún movimiento coincide con los filtros actuales.",
              )
            : `
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Fecha</th>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Colaborador</th>
                      <th>Sucursal destino</th>
                      <th>Stock después</th>
                      <th>Notificación</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredHistory
                      .map(
                        (record) => `
                          <tr>
                            <td>${renderHistoryType(record.type)}</td>
                            <td>${escapeHtml(formatDate(record.date))}</td>
                            <td>${escapeHtml(record.productName)}</td>
                            <td>${formatNumber(record.quantity)} ${escapeHtml(record.unit)}</td>
                            <td>${escapeHtml(record.collaboratorName || "Sin colaborador")}</td>
                            <td>${escapeHtml(record.destination || "No aplica")}</td>
                            <td>${formatNumber(record.stockAfter)} ${escapeHtml(record.unit)}</td>
                            <td>${escapeHtml(record.notificationMessage || "No aplica")}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderNotificationsSection() {
  return `
    <div class="page-stack">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Notificaciones internas relacionadas con Cocina</h2>
            <p>Estas alertas nacen desde las salidas de productos. La misma información se comparte con el módulo Cocina.</p>
          </div>
        </div>
        ${renderFlash("notifications")}
        ${renderNotificationsList(false)}
      </section>
    </div>
  `;
}

function renderBranchStorageProducts(branch, products) {
  const visibleProducts = products;
  const record = getBranchStorageRecord(branch.id);
  const canEditStoreStock = canEditBranchStoreStock(branch.id);
  const activeTurnLeader = getActiveTurnLeaderByBranch(branch.name);
  const stockEditorMessage = canEditStoreStock
    ? "Como Lider de turno de esta sucursal, puedes registrar el consumo base y decidir a que marcas se enviara cada producto. La cantidad diaria se ajusta dentro de cada marca."
    : activeTurnLeader
      ? `Solo ${activeTurnLeader.name} puede actualizar el consumo y distribuir productos de ${branch.name}. La cantidad diaria se ajusta dentro de cada marca.`
      : `Debes asignar un Lider de turno activo a ${branch.name} para cargar consumo y enviar productos a las marcas. La cantidad diaria se ajusta dentro de cada marca.`;

  return `
    <div class="page-stack">
      <section class="panel branch-banner-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Sucursal</p>
            <h2>${escapeHtml(branch.name)} · Almacén</h2>
            <p>Registra y visualiza aqui el stock real de tienda de esta sucursal.</p>
          </div>
          <div class="actions-row">
            <button class="btn btn-ghost" type="button" data-action="back-to-branch-brands">Volver a marcas</button>
            <button class="btn btn-ghost" type="button" data-action="back-to-branches">Volver a sucursales</button>
          </div>
        </div>
      </section>
      ${
        products.length === 0
          ? `
            <section class="panel">
              <div class="empty-state">
                <h3>No hay productos registrados todavia</h3>
                <p>Cuando registres productos en el sistema, apareceran aqui para cargar el stock real de tienda.</p>
              </div>
            </section>
          `
          : `
            <section class="panel">
                <div class="section-heading">
                  <div>
                    <h2>Consumo y stock de tienda</h2>
                    <p>Este modulo separa el ideal de tienda, el consumo base y el stock actual registrado de la sucursal.</p>
                  </div>
                </div>
              ${renderFlash("branches")}
              <div class="feedback ${canEditStoreStock ? "success" : "info"}">
                ${escapeHtml(stockEditorMessage)}
              </div>
              <div class="branch-checklist">
                ${visibleProducts
                  .map((product) => {
                    const status = getBranchStorageProductStatus(record, product);
                    const hasStoreStock = status.storeStock !== null;
                    const consumption = getBranchProductConsumption(branch.id, product.id);
                    const requestShortage = getBranchProductRequestShortage(record, product);
                    const assignedBrands = getBranchAssignedBrands(branch.id, product.id);
                    const stockFieldId = `branch-consumption-${branch.id}-storage-${product.id}`;

                    return `
                      <div class="branch-check-item ${status.label === "Bajo" ? "stock-alert-card blink-alert" : ""}">
                        <label class="branch-check-main">
                          <span class="branch-check-copy">
                            <strong>${escapeHtml(product.name)}</strong>
                            <small>Ideal tienda: ${formatNumber(product.stockIdeal)} ${escapeHtml(product.unit)}</small>
                            <small>
                              ${
                                consumption !== null
                                  ? `Consumo: ${formatNumber(consumption)} ${escapeHtml(product.unit)}`
                                  : "Consumo: sin registrar"
                              }
                            </small>
                            <small class="${status.label === "Bajo" ? "stock-shortage-copy" : ""}">
                              ${
                                hasStoreStock
                                  ? `Tienda: ${formatNumber(status.storeStock)} ${escapeHtml(product.unit)}`
                                  : requestShortage > 0
                                    ? `Tienda: sin stock registrado · Faltan ${formatNumber(requestShortage)} ${escapeHtml(product.unit)}`
                                    : "Tienda: sin stock registrado"
                              }
                            </small>
                            <small>
                              ${
                                assignedBrands.length > 0
                                  ? `Marcas asignadas: ${escapeHtml(assignedBrands.join(", "))}`
                                  : "Marcas asignadas: ninguna"
                              }
                            </small>
                            <small><span class="status-chip ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span></small>
                          </span>
                        </label>
                        <div class="branch-stock-field">
                          <label for="${escapeHtml(stockFieldId)}">Consumo de tienda</label>
                          <input
                            id="${escapeHtml(stockFieldId)}"
                            type="number"
                            step="0.01"
                            min="0"
                            inputmode="decimal"
                            placeholder="0"
                            value="${consumption !== null ? escapeHtml(String(consumption)) : ""}"
                            data-branch-consumption-input="true"
                            data-branch-id="${escapeHtml(branch.id)}"
                            data-product-id="${escapeHtml(product.id)}"
                            ${canEditStoreStock ? "" : "disabled"}
                          />
                        </div>
                        <div class="actions-row">
                          ${BRANCH_BRANDS.map((brandName) => {
                            const assigned = assignedBrands.includes(brandName);
                            return `
                              <button
                                class="btn ${assigned ? "btn-primary" : "btn-ghost"} btn-small"
                                type="button"
                                data-action="toggle-branch-storage-brand"
                                data-branch-id="${escapeHtml(branch.id)}"
                                data-brand-name="${escapeHtml(brandName)}"
                                data-product-id="${escapeHtml(product.id)}"
                                ${canEditStoreStock ? "" : "disabled"}
                              >
                                ${escapeHtml(brandName)}
                              </button>
                            `;
                          }).join("")}
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
      }
    </div>
  `;
}

function legacyRenderKitchenModule() {
  return `
    <div class="page-stack">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Notificaciones activas de reposición</h2>
            <p>Aquí llegan automáticamente las salidas de Cuarto Frío con producto, cantidad, fecha, destino y estado de la tarea.</p>
          </div>
        </div>
        ${renderFlash("notifications")}
        ${renderNotificationsList(true)}
      </section>
    </div>
  `;
}

function renderKitchenModule() {
  return `
    <div class="page-stack">
      <nav class="tab-strip" aria-label="Secciones de Cocina">
        ${renderKitchenTab("panel", "Panel")}
        ${renderKitchenTab("products", "Productos")}
      </nav>
      ${renderKitchenSection()}
    </div>
  `;
}

function renderKitchenTab(section, label) {
  return `
    <button
      class="tab-btn ${ui.kitchenSection === section ? "active" : ""}"
      data-action="set-kitchen-section"
      data-section="${section}"
    >
      ${label}
    </button>
  `;
}

function renderKitchenSection() {
  if (ui.kitchenSection === "products") {
    return renderKitchenProductsSection();
  }

  return renderKitchenPanelSection();
}

function getKitchenProductionSummary() {
  const summaryByProductId = new Map();

  state.kitchenOrders.forEach((order) => {
    if (order.sentToKitchen !== true || !Array.isArray(order.items)) {
      return;
    }

    order.items.forEach((item) => {
      const pendingQuantity = roundStock(Math.max(normalizeNumber(item.pending, 0), 0));
      if (!item.productId || pendingQuantity <= 0) {
        return;
      }

      const existing = summaryByProductId.get(item.productId) || {
        productId: item.productId,
        productName: item.productName,
        unit: item.unit || "unid.",
        totalQuantity: 0,
        orderIds: new Set(),
        destinations: new Set(),
      };

      existing.totalQuantity = roundStock(existing.totalQuantity + pendingQuantity);
      existing.orderIds.add(order.id);
      existing.destinations.add(`${order.branchName} / ${order.brandName}`);
      summaryByProductId.set(item.productId, existing);
    });
  });

  return [...summaryByProductId.values()]
    .map((entry) => ({
      ...entry,
      orderCount: entry.orderIds.size,
      destinationsList: [...entry.destinations].sort((left, right) => left.localeCompare(right, "es")),
    }))
    .sort((left, right) => left.productName.localeCompare(right.productName, "es"));
}

function renderKitchenProductionSummarySection() {
  const summaryItems = getKitchenProductionSummary();

  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>Pedidos consolidados para produccion</h2>
          <p>Aqui llegan solo los pedidos que el Encargado ya envio a Cocina, consolidados por producto.</p>
        </div>
      </div>
      ${
        summaryItems.length === 0
          ? renderEmptyState(
              "Todavia no hay produccion enviada a Cocina",
              "Los pedidos quedaran aqui cuando el Encargado los revise en Pedidos y pulse Enviar a Cocina.",
            )
          : `
            <div class="notification-list">
              ${summaryItems
                .map(
                  (item) => `
                    <article class="notification-card stock-alert-card">
                      <div class="notification-head">
                        <strong>${escapeHtml(item.productName)}</strong>
                        <span class="status-chip status-pendiente">Pendiente</span>
                      </div>
                      <div class="notification-body">
                        <p>Produccion consolidada para abastecer ${item.orderCount} pedido(s) de sucursal.</p>
                        <div class="notification-meta">
                          <span class="pill notification-quantity-pill">Cantidad total: ${formatNumber(item.totalQuantity)} ${escapeHtml(item.unit)}</span>
                          <span class="pill">Pedidos: ${item.orderCount}</span>
                          <span class="pill">Destinos: ${item.destinationsList.length}</span>
                        </div>
                        <p><strong>Destino(s):</strong> ${escapeHtml(item.destinationsList.join(", "))}</p>
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          `
      }
    </section>
  `;
}

function renderKitchenPanelSection() {
  return `
    <div class="page-stack">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Notificaciones activas de reposicion</h2>
            <p>Aqui llegan automaticamente las salidas de Cuarto Frio con producto, cantidad, fecha, destino y estado de la tarea.</p>
          </div>
        </div>
        ${renderFlash("notifications")}
        ${renderNotificationsList(true)}
      </section>
      ${renderBranchNotificationsSection()}
    </div>
  `;
}

function renderKitchenOrdersList() {
  const orders = getSortedKitchenOrders();

  if (orders.length === 0) {
    return renderEmptyState(
      "Todavia no hay pedidos enviados",
      "Marca productos en Cocina > Productos y autorizalos para que aparezcan aqui con opcion de impresion.",
    );
  }

  return `
    <div class="notification-list">
      ${orders.map((order) => renderKitchenOrderCard(order)).join("")}
    </div>
  `;
}

function getKitchenOrderPendingItems(order) {
  if (!Array.isArray(order?.items)) {
    return [];
  }

  return order.items.filter(
    (item) => roundStock(Math.max(normalizeNumber(item.pending, 0), 0)) > 0,
  );
}

function isKitchenOrderFullyDispatched(order) {
  return getKitchenOrderPendingItems(order).length === 0;
}

function getKitchenOrderStatusMeta(order) {
  if (order.sentToBranch) {
    return {
      label: "Enviado a sucursal",
      className: "status-active",
      canForward: false,
      canSendToKitchen: false,
      helper: "Este pedido ya fue enviado a la sucursal.",
    };
  }

  if (isKitchenOrderFullyDispatched(order)) {
    return {
      label: "Despachado",
      className: "status-active",
      canForward: false,
      canSendToKitchen: false,
      helper: "Este pedido ya fue despachado por completo.",
    };
  }

  if (order.forwardedToDispatch) {
    return {
      label: "Enviado al encargado",
      className: "status-en_progreso",
      canForward: false,
      canSendToKitchen: false,
      helper: "Este pedido ya fue revisado por el encargado y espera la salida automatica.",
    };
  }

  return {
    label: "Pendiente",
    className: "status-pendiente",
    canForward: true,
    canSendToKitchen: false,
    helper: "Todavia no se ha enviado al encargado.",
  };
}

function renderKitchenOrderCard(order) {
  const statusMeta = getKitchenOrderStatusMeta(order);
  return `
    <article class="notification-card">
      <div class="notification-head">
        <strong>Pedido ${escapeHtml(order.number)}</strong>
        <span class="status-chip ${escapeHtml(statusMeta.className)}">${escapeHtml(statusMeta.label)}</span>
      </div>
      <div class="notification-body">
        <p><strong>${escapeHtml(order.branchName)} / ${escapeHtml(order.brandName)}</strong></p>
        <div class="notification-meta">
          <span class="pill">Fecha: ${escapeHtml(formatDate(order.date))}</span>
          <span class="pill">Solicitante: ${escapeHtml(order.requesterName || "Sin solicitante")}</span>
          <span class="pill">Autorizado por: ${escapeHtml(order.authorizedByName || "Sin autorizacion")}</span>
          <span class="pill">${order.items.length} productos</span>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Unidad</th>
                <th>Solicitado</th>
                <th>Entregado</th>
                <th>Pendiente</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${order.items
                .map(
                  (item) => `
                    <tr>
                      <td>${escapeHtml(item.productName)}</td>
                      <td>${escapeHtml(item.unit || "unid.")}</td>
                      <td>${formatNumber(item.requested)}</td>
                      <td><input type="number" value="${formatNumber(item.delivered)}" class="input-entregado" data-order-id="${escapeHtml(order.id)}" data-product-id="${escapeHtml(item.productId)}" min="0"></td>
                      <td>${formatNumber(item.pending)}</td>
                      <td><button class="btn-x" data-action="mark-unavailable" data-order-id="${escapeHtml(order.id)}" data-product-id="${escapeHtml(item.productId)}" data-product-name="${escapeHtml(item.productName)}">X</button></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="text-soft">${escapeHtml(statusMeta.helper)}</p>
      </div>
      <div class="notification-actions">
        ${
          statusMeta.canForward
            ? `
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-action="forward-kitchen-order"
                data-id="${escapeHtml(order.id)}"
              >
                Enviar al encargado
              </button>
            `
            : ""
        }
        ${
          order.forwardedToDispatch && !order.sentToBranch
            ? `
              <button
                class="btn btn-success btn-small"
                type="button"
                data-action="send-to-branch"
                data-id="${escapeHtml(order.id)}"
              >
                Enviar a sucursal
              </button>
            `
            : ""
        }
        <button
          class="btn btn-primary btn-small"
          type="button"
          data-action="print-kitchen-order"
          data-id="${escapeHtml(order.id)}"
        >
          Imprimir pedido
        </button>
        <!-- Botón de emergencia que funciona directamente -->
        <button
          class="btn btn-danger btn-small"
          type="button"
          onclick="emergencyDeleteOrder('${escapeHtml(order.id)}', '${escapeHtml(order.number)}')"
        >
          🚨 Eliminar pedido
        </button>
      </div>
    </article>
  `;
}

function renderKitchenProductsSection() {
  const products = getSortedProducts();
  const inventoryPanel = renderKitchenInventoryCatalogPanel(products);
  return `
    <div class="page-stack">
      ${inventoryPanel}
    </div>
  `;
}

function renderKitchenInventoryCatalogPanel(products) {
  const canManageCatalog = canManageKitchenProductCatalog();

  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>Inventario disponible</h2>
          <p>Aqui puedes ver el panel general de productos registrado en el sistema antes de revisar pedidos por sucursal.</p>
        </div>
      </div>
      ${renderFlash("products")}
      ${
        products.length === 0
          ? renderEmptyState(
              "No hay productos registrados",
              "Registra productos en el sistema para que aparezcan tambien en Cocina.",
            )
          : `
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Categoría</th>
                    <th>Stock actual</th>
                    <th>Stock ideal</th>
                    <th>Estado</th>
                    <th>Equipo vinculado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${products
                    .map((product) => {
                      const linkedCollaborators = getAssignmentsForProduct(product.id);
                      const lowStock = isProductLowStock(product);
                      return `
                        <tr class="${lowStock ? "low-stock-row" : ""}">
                          <td><strong>${escapeHtml(product.name)}</strong></td>
                          <td>${escapeHtml(product.unit)}</td>
                          <td>${escapeHtml(product.category || "Sin categoría")}</td>
                          <td>${formatNumber(product.stockCurrent)} ${escapeHtml(product.unit)}</td>
                          <td>${formatNumber(product.stockIdeal)} ${escapeHtml(product.unit)}</td>
                          <td>${renderProductStatus(product)}</td>
                          <td>
                            ${
                              linkedCollaborators.length === 0
                                ? '<span class="text-soft">Sin asignaciones</span>'
                                : `<div class="tag-list">${linkedCollaborators
                                    .map(
                                      (assignment) => `
                                        <span class="tag">${escapeHtml(assignment.collaboratorName)}</span>
                                      `,
                                    )
                                    .join("")}</div>`
                            }
                          </td>
                          <td>
                            ${
                              canManageCatalog
                                ? `
                                  <div class="actions-row">
                                    <button class="btn btn-secondary btn-small" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}">Editar</button>
                                    <button class="btn btn-danger btn-small" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}">Eliminar</button>
                                  </div>
                                `
                                : '<span class="text-soft">Solo lectura</span>'
                            }
                          </td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
      }
    </section>
  `;
}

function renderKitchenBranchLandingCard(branch) {
  const requestedCount = getBranchRequestedProductsCount(branch.id);
  const activeBrands = getBranchActiveBrandCount(branch.id);

  return `
    <article class="module-card home-module-card">
      <div>
        <p class="eyebrow">Sucursal</p>
        <h2>${escapeHtml(branch.name)}</h2>
        <p>Entra a esta sucursal para abrir Green Salad o La Pasta y revisar sus productos.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${BRANCH_BRANDS.length} marcas</span>
        <span class="pill">${requestedCount} productos solicitados</span>
        <span class="pill">${activeBrands} marcas activas</span>
      </div>
      <button class="btn btn-primary" type="button" data-action="open-kitchen-branch" data-branch-id="${escapeHtml(branch.id)}">
        Abrir ${escapeHtml(branch.name)}
      </button>
    </article>
  `;
}

function renderKitchenBrandCard(branch, brandName, products) {
  const visibleProducts = getBranchBrandVisibleProducts(branch.id, brandName, products);
  const record = getBranchNeedRecord(branch.id, brandName);
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const selectedCount = getRequestableBranchProductIds(record).filter((productId) =>
    visibleProductIds.has(productId),
  ).length;
  const lastUpdateLabel =
    selectedCount > 0 && record.updatedAt
      ? `Actualizado ${formatDateTime(record.updatedAt)}`
      : "Sin pedidos activos";

  return `
    <article class="module-card home-module-card">
      <div>
        <p class="eyebrow">${escapeHtml(branch.name)}</p>
        <h2>${escapeHtml(brandName)}</h2>
        <p>Consulta que tiene esta marca y marca los ingredientes o productos que necesita pedir.</p>
      </div>
      <div class="stat-strip">
        <span class="pill">${visibleProducts.length} productos visibles</span>
        <span class="pill">${selectedCount} solicitados</span>
        <span class="pill">${escapeHtml(lastUpdateLabel)}</span>
      </div>
      <button
        class="btn btn-primary"
        type="button"
        data-action="open-kitchen-brand"
        data-branch-id="${escapeHtml(branch.id)}"
        data-brand-name="${escapeHtml(brandName)}"
      >
        Abrir ${escapeHtml(brandName)}
      </button>
    </article>
  `;
}

function renderKitchenBrandProducts(branch, brandName, products, canGoBackToBranches) {
  const visibleProducts = getBranchBrandVisibleProducts(branch.id, brandName, products);
  const record = getBranchNeedRecord(branch.id, brandName);
  const selectedProductIds = new Set(getRequestableBranchProductIds(record));
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const selectedCount = getRequestableBranchProductIds(record).filter((productId) =>
    visibleProductIds.has(productId),
  ).length;
  const draftItems = getKitchenOrderDraftItems(branch.id, brandName);
  const stockEditorMessage =
    "El stock real y el consumo de tienda se gestionan desde Almacen. Aqui solo marcas lo que esta marca necesita.";
  const orderAccess = getKitchenOrderAccess(branch.id, brandName);

  return `
    <div class="page-stack">
      <section class="panel branch-banner-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Cocina y marca</p>
            <h2>${escapeHtml(branch.name)} · ${escapeHtml(brandName)}</h2>
            <p>Aqui se muestran los productos disponibles de esta marca para registrar lo que tiene y realizar el pedido.</p>
          </div>
          <div class="actions-row">
            <button class="btn btn-ghost" type="button" data-action="back-to-kitchen-brands">Volver a marcas</button>
            ${
              canGoBackToBranches
                ? '<button class="btn btn-ghost" type="button" data-action="back-to-kitchen-branches">Volver a sucursales</button>'
                : ""
            }
          </div>
        </div>
      </section>
      ${
        products.length === 0
          ? `
            <section class="panel">
              <div class="empty-state">
                <h3>No hay productos registrados todavia</h3>
                <p>Cuando crees productos en Cuarto Frio, esta marca podra verlos aqui automaticamente.</p>
              </div>
            </section>
          `
          : visibleProducts.length === 0
            ? `
              <section class="panel">
                <div class="empty-state">
                  <h3>Esta marca todavia no tiene productos asignados</h3>
                  <p>Abre Almacen y usa los botones Green Salad o La Pasta para enviar productos a esta marca.</p>
                </div>
              </section>
            `
            : `
              <section class="panel">
                <div class="section-heading">
                  <div>
                    <h2>Productos disponibles</h2>
                    <p>Estos productos vienen de Cuarto Frio. Marca aqui lo que esta marca necesita para generar el pedido.</p>
                  </div>
                </div>
                ${renderFlash("branches")}
                <div class="feedback info">
                  ${escapeHtml(stockEditorMessage)}
                </div>
                <div class="feedback ${orderAccess.allowed ? "info" : "error"}">
                  ${escapeHtml(orderAccess.message)}
                </div>
                <div class="branch-checklist">
                  ${visibleProducts
                  .map((product) => {
                      const selected = selectedProductIds.has(product.id);
                      const dailyQuantity = getBranchProductDailyQuantity(branch.id, product.id);
                      const requestBase = getBranchProductRequestBase(branch.id, product);
                      const orderQuantity = getBranchProductOrderQuantity(record, product);

                      return `
                        <div class="branch-check-item ${selected ? "checked" : ""}">
                          <label class="branch-check-main">
                            <input
                              type="checkbox"
                              data-branch-id="${escapeHtml(branch.id)}"
                              data-brand-name="${escapeHtml(brandName)}"
                              data-product-id="${escapeHtml(product.id)}"
                              ${selected ? "checked" : ""}
                            />
                            <span class="branch-check-copy">
                              <strong>${escapeHtml(product.name)}</strong>
                              <small>${escapeHtml(formatBranchProductMeta(product))}</small>
                              ${
                                dailyQuantity !== null
                                  ? `<small>Cantidad actual: ${formatNumber(dailyQuantity)} ${escapeHtml(product.unit)}</small>`
                                  : ""
                              }
                              <small>
                                ${
                                  requestBase > 0
                                    ? `Tienda: ${formatNumber(requestBase)} ${escapeHtml(product.unit)} &middot; Abastecido`
                                    : "Tienda: sin stock registrado"
                                }
                              </small>
                              <small class="${orderQuantity > 0 ? "stock-shortage-copy" : ""}">
                                ${
                                  orderQuantity > 0
                                    ? `Se pediran ${formatNumber(orderQuantity)} ${escapeHtml(product.unit)} para completar tienda.`
                                    : "No hace falta pedir este producto ahora."
                                }
                              </small>
                            </span>
                          </label>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
                <div class="kitchen-order-footer">
                  <div class="subtle-list">
                    <div class="subtle-item">
                      <span class="text-soft">Productos marcados</span>
                      <strong>${selectedCount}</strong>
                    </div>
                    <div class="subtle-item">
                      <span class="text-soft">Lineas listas para pedir</span>
                      <strong>${draftItems.length}</strong>
                    </div>
                  </div>
                  <div class="actions-row">
                    <button
                      class="btn btn-primary"
                      type="button"
                      data-action="request-kitchen-order"
                      data-branch-id="${escapeHtml(branch.id)}"
                      data-brand-name="${escapeHtml(brandName)}"
                      ${orderAccess.allowed && draftItems.length > 0 ? "" : "disabled"}
                    >
                      ${orderAccess.requiresLeaderPassword ? "Enviar pedido con clave del Lider" : "Enviar pedido a Cocina"}
                    </button>
                  </div>
                </div>
              </section>
            `
      }
    </div>
  `;
}
function canManageNotificationTasks() {
  return session.authenticated === true && ui.currentModule === "kitchen";
}

function renderNotificationsList(allowTaskActions = false) {
  const notifications = getSortedNotifications();
  const deliveryIncidents = getDeliveryIncidents();

  if (notifications.length === 0 && deliveryIncidents.length === 0) {
    return renderEmptyState(
      "No hay notificaciones activas todavía",
      "Cuando Cuarto Frío o una tienda queden por debajo del stock ideal, la reposición aparecerá aquí automáticamente.",
    );
  }

  return `
    <div class="notification-list">
      ${deliveryIncidents
        .map((incident) => `
          <article class="notification-card incidente">
            <div class="notification-head">
              <strong>⚠️ Incidente en Pedido ${escapeHtml(incident.orderNumber)}</strong>
              <span class="status-chip status-pendiente">Incidencia</span>
            </div>
            <div class="notification-body">
              <p><strong>Sucursal:</strong> ${escapeHtml(incident.branchName)} / ${escapeHtml(incident.brandName)}</p>
              <div class="incidente-list">
                <h4>Detalle del incidente:</h4>
                <ul>
                  <li><strong>Producto:</strong> ${escapeHtml(incident.productName)}</li>
                  <li><strong>Tipo:</strong> ${incident.incidentType === 'cantidad_modificada' ? 'Cantidad modificada' : 'Producto no disponible'}</li>
                  ${
                    incident.incidentType === 'cantidad_modificada'
                      ? `<li><strong>Cambiado de:</strong> ${incident.requestedQuantity} a ${incident.deliveredQuantity}</li>`
                      : ''
                  }
                </ul>
              </div>
              <div class="notification-meta">
                <span class="pill">Fecha: ${escapeHtml(formatDate(incident.timestamp))}</span>
              </div>
            </div>
          </article>
        `)
        .join("")}
      ${notifications
        .map((notification) => {
          const alertActive = isNotificationAlertActive(notification);
          const sourceType = normalizeNotificationSourceType(notification.sourceType, notification);
          const liveCollaborators = getActiveAssignedCollaboratorNames(notification.productId);
          const displayCollaborators =
            liveCollaborators.length > 0 ? liveCollaborators : notification.collaboratorNames;
          return `
            <article class="notification-card ${alertActive ? "stock-alert-card blink-alert" : ""}">
              <div class="notification-head">
                <strong>${escapeHtml(notification.productName)}</strong>
                ${renderNotificationStatusChip(notification, alertActive)}
              </div>
              <div class="notification-body">
                <p>${escapeHtml(notification.message)}</p>
                <div class="notification-meta">
                  <span class="pill">Fecha: ${escapeHtml(formatDate(notification.date))}</span>
                  <span class="pill notification-quantity-pill">Cantidad: ${formatNumber(notification.quantity)} ${escapeHtml(notification.unit)}</span>
                  <span class="pill">Destino: ${escapeHtml(notification.destination || "No indicado")}</span>
                  ${renderNotificationTimerPill(notification)}
                </div>
                <p><strong>Colaborador asignado:</strong> ${
                  displayCollaborators.length > 0
                    ? escapeHtml(displayCollaborators.join(", "))
                    : "Sin colaborador asignado"
                }</p>
              </div>
              <div class="notification-actions">
                ${
                  allowTaskActions
                    ? `
                        ${
                          notification.status !== "en_progreso"
                            ? `<button class="btn btn-secondary btn-small" type="button" data-action="set-notification-status" data-id="${escapeHtml(notification.id)}" data-status="en_progreso">Marcar en proceso</button>`
                            : ""
                        }
                        ${
                          notification.status !== "completada"
                            ? `<button class="btn btn-primary btn-small" type="button" data-action="set-notification-status" data-id="${escapeHtml(notification.id)}" data-status="completada">Completar</button>`
                            : ""
                        }
                      `
                    : '<span class="text-soft">Gestiona esta tarea desde Cocina.</span>'
                }
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderControlSection() {
  const productMetrics = getProductConsumptionMetrics();
  const collaboratorMetrics = getCollaboratorSpeedMetrics();
  const topProduct = productMetrics[0] || null;
  const fastestCollaborator = collaboratorMetrics[0] || null;
  const completedTasks = getCompletedTaskNotifications();
  const activeTimers = getSortedNotifications();
  const averageProductionMs = getAverageNotificationDurationMs(completedTasks);
  const longestPending = getLongestPendingNotification();
  const maxProductScore = Math.max(...productMetrics.map((metric) => metric.score), 1);
  const maxCollaboratorDuration = Math.max(
    ...collaboratorMetrics.map((metric) => metric.averageDurationMs),
    1,
  );

  return `
    <div class="page-stack">
      <section class="stats-grid">
        <article class="stat-card">
          <h3>Producto que mas se agota</h3>
          <span class="dashboard-lead">${topProduct ? escapeHtml(topProduct.name) : "Sin datos"}</span>
          <p>${
            topProduct
              ? `${topProduct.lowStockHits} alertas por stock bajo y ${topProduct.exitCount} salidas registradas.`
              : "Registra salidas para detectar el producto mas exigido."
          }</p>
        </article>
        <article class="stat-card">
          <h3>Tiempo promedio de produccion</h3>
          <span class="dashboard-lead">${completedTasks.length > 0 ? escapeHtml(formatElapsedTime(averageProductionMs)) : "--"}</span>
          <p>${
            completedTasks.length > 0
              ? `${completedTasks.length} tareas completadas ya alimentan este promedio.`
              : "Aun no hay tareas completadas para medir tiempo promedio."
          }</p>
        </article>
        <article class="stat-card">
          <h3>Colaborador mas rapido</h3>
          <span class="dashboard-lead">${fastestCollaborator ? escapeHtml(fastestCollaborator.name) : "Sin datos"}</span>
          <p>${
            fastestCollaborator
              ? `Promedio ${formatElapsedTime(fastestCollaborator.averageDurationMs)} en ${fastestCollaborator.taskCount} tareas.`
              : "Completa reposiciones para detectar quien termina primero."
          }</p>
        </article>
        <article class="stat-card">
          <h3>Temporizador mas largo activo</h3>
          <span class="dashboard-lead">${longestPending ? escapeHtml(longestPending.productName) : "Sin alertas"}</span>
          <p>${
            longestPending
              ? `Lleva ${formatElapsedTime(getElapsedMs(longestPending.createdAt))} en espera de reposicion.`
              : "No hay tareas activas pendientes ahora mismo."
          }</p>
        </article>
      </section>

      <section class="split-grid">
        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Productos con mayor desgaste</h2>
              <p>Este grafico resume que producto se agota con mas frecuencia segun salidas e impactos de stock bajo.</p>
            </div>
          </div>
          ${
            productMetrics.length === 0
              ? renderEmptyState(
                  "Aun no hay metricas de productos",
                  "Cuando registres salidas y movimientos, aqui veras cual producto se agota con mas frecuencia.",
                )
              : `
                <div class="metric-chart">
                  ${productMetrics
                    .slice(0, 5)
                    .map(
                      (metric) => `
                        <article class="metric-row">
                          <div class="metric-head">
                            <strong>${escapeHtml(metric.name)}</strong>
                            <span>${metric.lowStockHits} alertas · ${metric.exitCount} salidas</span>
                          </div>
                          <div class="metric-track">
                            <span class="metric-fill metric-fill-danger" style="width: ${formatChartWidth(metric.score, maxProductScore)}"></span>
                          </div>
                          <p class="helper-text">Salida total: ${formatNumber(metric.totalOutput)} ${escapeHtml(metric.unit || "unid.")}</p>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
          }
        </article>

        <article class="panel">
          <div class="section-heading">
            <div>
              <h2>Velocidad por colaborador</h2>
              <p>Se calcula con tareas de reposicion completadas y el tiempo que tardo cada una desde que llego la alerta.</p>
            </div>
          </div>
          ${
            collaboratorMetrics.length === 0
              ? renderEmptyState(
                  "Todavia no hay tiempos por colaborador",
                  "Completa reposiciones para comparar quien termina mas rapido sus funciones.",
                )
              : `
                <div class="metric-chart">
                  ${collaboratorMetrics
                    .slice(0, 5)
                    .map(
                      (metric) => `
                        <article class="metric-row">
                          <div class="metric-head">
                            <strong>${escapeHtml(metric.name)}</strong>
                            <span>${formatElapsedTime(metric.averageDurationMs)} promedio</span>
                          </div>
                          <div class="metric-track">
                            <span class="metric-fill metric-fill-success" style="width: ${formatChartWidth(metric.averageDurationMs, maxCollaboratorDuration)}"></span>
                          </div>
                          <p class="helper-text">${metric.taskCount} tareas completadas asociadas.</p>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
          }
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Temporizadores activos de produccion</h2>
            <p>Este panel muestra las alertas pendientes con el tiempo transcurrido para reconocer la urgencia operativa.</p>
          </div>
        </div>
        ${
          activeTimers.length === 0
            ? renderEmptyState(
                "No hay temporizadores activos",
                "Cuando una reposicion quede pendiente, aparecera aqui con su tiempo transcurrido.",
              )
            : `
              <div class="metric-chart">
                ${activeTimers
                  .map(
                    (notification) => `
                      <article class="metric-row stock-alert-card">
                        <div class="metric-head">
                          <strong>${escapeHtml(notification.productName)}</strong>
                          <span>${escapeHtml(notification.destination || "Reposicion interna")}</span>
                        </div>
                        <div class="timer-grid">
                          ${renderNotificationTimerPill(notification)}
                          <span class="pill notification-quantity-pill">Cantidad: ${formatNumber(notification.quantity)} ${escapeHtml(notification.unit)}</span>
                        </div>
                        <p class="helper-text">${
                          notification.collaboratorNames.length > 0
                            ? `Equipo: ${escapeHtml(notification.collaboratorNames.join(", "))}`
                            : "Sin colaborador asignado"
                        }</p>
                      </article>
                    `,
                  )
                  .join("")}
              </div>
            `
        }
      </section>
    </div>
  `;
}

function renderDestinationOptions(selectedValue = "") {
  return DESTINATIONS.map(
    (destination) => `
      <optgroup label="${escapeHtml(destination.zone)}">
        ${destination.branches
          .map(
            (branch) => `
              <option value="${escapeHtml(`${destination.zone} / ${branch}`)}" ${selectedValue === `${destination.zone} / ${branch}` ? "selected" : ""}>${escapeHtml(branch)}</option>
            `,
          )
          .join("")}
      </optgroup>
    `,
  ).join("");
}

function getInventoryHighlights() {
  const highlights = getSortedProducts().slice(0, 4);
  return highlights
    .map(
      (product) => `
        <div class="inventory-item ${isProductLowStock(product) ? "stock-alert-card blink-alert" : ""}">
          <strong>${escapeHtml(product.name)}</strong>
          <p class="helper-text">Stock actual: ${formatNumber(product.stockCurrent)} ${escapeHtml(product.unit)} · Ideal: ${formatNumber(product.stockIdeal)} ${escapeHtml(product.unit)}</p>
        </div>
      `,
    )
    .join("");
}

function renderHistoryType(type) {
  if (type === "salida") {
    return '<span class="status-chip status-en_progreso">Salida</span>';
  }
  return '<span class="status-chip status-active">Entrada</span>';
}

function renderStatusChip(status) {
  const normalizedStatus = normalizeNotificationStatus(status);
  const labelMap = {
    active: "Activo",
    inactive: "Inactivo",
    pendiente: "Pendiente",
    en_progreso: "En proceso",
    completada: "Completada",
  };
  return `<span class="status-chip status-${escapeHtml(normalizedStatus)}">${labelMap[normalizedStatus] || "Activo"}</span>`;
}

function renderCollaboratorPresenceChip(collaboratorId) {
  if (!isCollaboratorOnline(collaboratorId)) {
    return "";
  }

  return '<span class="status-chip status-online blink-online">Activo ahora</span>';
}

function renderNotificationStatusChip(notification, alertActive = false) {
  const normalizedStatus = normalizeNotificationStatus(notification.status);
  const labelMap = {
    pendiente: "Pendiente",
    en_progreso: "En proceso",
    completada: "Completada",
  };
  const extraClass = alertActive ? " status-alert blink-alert" : "";
  return `<span class="status-chip status-${escapeHtml(normalizedStatus)}${extraClass}">${labelMap[normalizedStatus] || "Pendiente"}</span>`;
}

function renderNotificationTimerPill(notification) {
  const completed = Boolean(notification.completedAt);
  return `
    <span
      class="pill timer-pill ${completed ? "timer-complete" : "timer-live"}"
      data-timer-start="${escapeHtml(notification.createdAt || "")}"
      data-timer-end="${escapeHtml(notification.completedAt || "")}"
      data-timer-label-live="Tiempo"
      data-timer-label-done="Tiempo final"
    >
      ${escapeHtml(renderTimerText(notification.createdAt, notification.completedAt, "Tiempo", "Tiempo final"))}
    </span>
  `;
}

function renderProductStatus(product) {
  if (product.status === "inactive") {
    return renderStatusChip("inactive");
  }

  if (isProductLowStock(product)) {
    return '<span class="status-chip status-alert blink-alert">Stock bajo</span>';
  }

  return renderStatusChip("active");
}

function renderFlash(scope) {
  if (!ui.flash || ui.flash.scope !== scope) {
    return "";
  }

  const durationMs =
    typeof ui.flash.durationMs === "number" && Number.isFinite(ui.flash.durationMs)
      ? Math.max(ui.flash.durationMs, 1)
      : 10000;
  const startedAt =
    typeof ui.flash.startedAt === "number" && Number.isFinite(ui.flash.startedAt)
      ? ui.flash.startedAt
      : Date.now();
  const elapsedMs = Math.max(0, Math.min(Date.now() - startedAt, durationMs));

  return `
    <div class="feedback flash-toast ${escapeHtml(ui.flash.type)}" style="--flash-duration: ${durationMs}ms; --flash-delay: -${elapsedMs}ms;">
      ${escapeHtml(ui.flash.message)}
    </div>
  `;
}

function renderSyncBadge() {
  const labelMap = {
    online: "Sincronización en vivo",
    connecting: "Conectando...",
    error: "Modo local",
  };
  const extraClass = cloudSync.status === "error" ? " blink-alert" : "";

  return `
    <span class="sync-pill sync-${escapeHtml(cloudSync.status)}${extraClass}">
      ${escapeHtml(labelMap[cloudSync.status] || "Conectando...")}
    </span>
  `;
}

function renderSyncBanner() {
  if (cloudSync.status === "online") {
    return "";
  }

  const type = cloudSync.status === "error" ? "error" : "info";

  return `
    <div class="feedback ${type}">
      ${escapeHtml(cloudSync.statusMessage)}
    </div>
  `;
}

function getTechnicalSnapshot() {
  const loginCollaborator = session.loginCollaboratorId
    ? getCollaboratorById(session.loginCollaboratorId)
    : null;
  const coldRoomCollaborator = session.coldRoomAccessCollaboratorId
    ? getCollaboratorById(session.coldRoomAccessCollaboratorId)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    session: {
      authenticated: session.authenticated === true,
      currentModule: formatTechnicalModule(ui.currentModule),
      loginRole: loginCollaborator
        ? `${formatCollaboratorRole(loginCollaborator.area)} · ${loginCollaborator.name}`
        : session.loginRole
          ? formatCollaboratorRole(session.loginRole)
          : "Sin rol operativo",
      coldRoomAccess: session.coldRoomAuthorized
        ? coldRoomCollaborator
          ? `${formatCollaboratorRole(coldRoomCollaborator.area)} · ${coldRoomCollaborator.name}`
          : "Administrativo"
        : "Sin acceso activo",
      viewport: `${window.innerWidth} x ${window.innerHeight}`,
    },
    sync: {
      status: cloudSync.status,
      message: cloudSync.statusMessage,
      onlineUsers: getOnlineCollaborators().map((collaborator) => ({
        name: collaborator.name,
        role: formatCollaboratorRole(collaborator.area),
        branch: collaborator.branch || "",
      })),
    },
    summary: {
      products: state.products.length,
      collaborators: state.collaborators.length,
      assignments: state.assignments.length,
      branchRequests: getTotalBranchRequestedProducts(),
      pendingNotifications: getPendingNotifications().length,
      history: state.history.length,
    },
    data: {
      products: getSortedProducts().map((product) => ({
        name: product.name,
        unit: product.unit,
        stockCurrent: product.stockCurrent,
        stockIdeal: product.stockIdeal,
        status: product.status,
      })),
      collaborators: getSortedCollaborators().map((collaborator) => ({
        name: collaborator.name,
        role: formatCollaboratorRole(collaborator.area),
        branch: collaborator.branch || "",
        status: collaborator.status,
      })),
      pendingNotifications: getPendingNotifications().map((notification) => ({
        product: notification.productName,
        quantity: notification.quantity,
        unit: notification.unit,
        destination: notification.destination,
        status: notification.status,
      })),
      branchNeeds: BRANCH_LOCATIONS.map((branch) => ({
        branch: branch.name,
        brands: BRANCH_BRANDS.map((brandName) => {
          const record = getBranchNeedRecord(branch.id, brandName);
          return {
            brand: brandName,
            requestedProducts: record.productIds
              .map((productId) => {
                const product = getProductById(productId);
                if (!product) {
                  return "";
                }

                const storeStock = getBranchProductStoreStock(record, productId);
                const orderQuantity = getBranchProductOrderQuantity(record, product);
                const dailyQuantity = getBranchProductDailyQuantity(record.branchId, product.id);
                return `${product.name} | tienda ${storeStock === null ? "sin stock" : `${formatNumber(storeStock)} ${product.unit}`}${dailyQuantity !== null && dailyQuantity > 0 ? ` | quedan hoy ${formatNumber(dailyQuantity)} ${product.unit} | pedir ${formatNumber(orderQuantity)} ${product.unit}` : orderQuantity > 0 ? ` | faltan ${formatNumber(orderQuantity)} ${product.unit}` : ""}`;
              })
              .filter(Boolean),
            updatedAt: record.updatedAt,
          };
        }),
      })),
    },
  };
}

function formatTechnicalModule(value) {
  const labelMap = {
    home: "Modulos",
    "cold-room": "Cuarto Frio",
    kitchen: "Cocina",
    orders: "Pedidos",
    branches: "Sucursales",
  };

  return labelMap[String(value || "")] || "Modulo no identificado";
}

function renderOperatorControl() {
  return "";
}

function hydrateRoleField() {
  const roleInput = app.querySelector("#collaborator-area");
  if (!(roleInput instanceof HTMLInputElement)) {
    return;
  }

  const select = document.createElement("select");
  select.id = "collaborator-area";
  select.name = "area";
  select.required = true;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecciona un rol";
  select.appendChild(placeholder);

  const currentValue = normalizeCollaboratorRole(roleInput.value);

  COLLABORATOR_ROLES.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.value;
    option.textContent = role.label;
    option.selected = currentValue === role.value;
    select.appendChild(option);
  });

  const label = roleInput.closest(".field")?.querySelector("label");
  if (label) {
    label.textContent = "Rol del colaborador";
  }

  app.querySelectorAll("th").forEach((cell) => {
    if (cell.textContent?.trim().toLowerCase().includes("área")) {
      cell.textContent = "Rol";
    }
  });

  roleInput.replaceWith(select);
}

function hydrateCollaboratorBranchField() {
  const collaboratorForm = app.querySelector("#collaborator-form");
  if (!(collaboratorForm instanceof HTMLFormElement)) {
    return;
  }

  const editingCollaborator = ui.editingCollaboratorId
    ? getCollaboratorById(ui.editingCollaboratorId)
    : null;
  const roleField = collaboratorForm.querySelector("#collaborator-area");
  const statusField = collaboratorForm.querySelector("#collaborator-status")?.closest(".field");
  const existingField = collaboratorForm.querySelector("[data-collaborator-branch-field]");

  const wrapper = existingField || document.createElement("div");
  wrapper.className = "field";
  wrapper.dataset.collaboratorBranchField = "true";
  wrapper.innerHTML = `
    <label for="collaborator-branch">Sucursal</label>
    <select id="collaborator-branch" name="branch" required>
      <option value="">Selecciona una sucursal</option>
      ${renderCollaboratorBranchOptions(editingCollaborator?.branch || "")}
    </select>
  `;

  if (existingField) {
    return;
  }

  if (statusField?.parentElement === collaboratorForm) {
    collaboratorForm.insertBefore(wrapper, statusField);
    return;
  }

  if (roleField?.closest(".field")?.parentElement === collaboratorForm) {
    collaboratorForm.appendChild(wrapper);
  }
}

function hydrateCollaboratorPasswordField() {
  const collaboratorForm = app.querySelector("#collaborator-form");
  const roleField = app.querySelector("#collaborator-area");
  if (!(collaboratorForm instanceof HTMLFormElement) || !(roleField instanceof HTMLSelectElement)) {
    return;
  }

  const currentRole = normalizeCollaboratorRole(roleField.value);
  const credentialConfig = getCredentialFieldConfig(currentRole);
  const existingField = collaboratorForm.querySelector("[data-collaborator-password-field]");
  const editingCollaborator = ui.editingCollaboratorId
    ? getCollaboratorById(ui.editingCollaboratorId)
    : null;

  if (!credentialConfig) {
    existingField?.remove();
    return;
  }

  const wrapper = existingField || document.createElement("div");
  wrapper.className = "credential-panel full-span";
  wrapper.dataset.collaboratorPasswordField = "true";
  wrapper.innerHTML = `
    <div class="credential-panel-copy">
      <h3>${credentialConfig.title}</h3>
      <p>${credentialConfig.description}</p>
    </div>
    <div class="field">
      <label for="collaborator-password">${credentialConfig.label}</label>
      <input
        id="collaborator-password"
        name="accessPassword"
        type="password"
        placeholder="${editingCollaborator?.password ? "Deja vacia para mantener la actual" : credentialConfig.placeholder}"
        ${editingCollaborator?.password ? "" : "required"}
      />
      <small class="field-hint">${credentialConfig.hint}</small>
    </div>
  `;

  if (!existingField) {
    const actionsField = collaboratorForm.querySelector(".field.full-span");
    if (actionsField?.parentElement === collaboratorForm) {
      collaboratorForm.insertBefore(wrapper, actionsField);
    } else {
      collaboratorForm.appendChild(wrapper);
    }
  }
}

function hydrateExitAccess() {
  const exitForm = app.querySelector("#exit-form");
  if (!(exitForm instanceof HTMLFormElement)) {
    return;
  }

  const existingBanner = exitForm.parentElement?.querySelector("[data-exit-access-banner]");
  if (existingBanner) {
    existingBanner.remove();
  }

  const infoBlock = document.createElement("div");
  infoBlock.dataset.exitAccessBanner = "true";
  infoBlock.className = `feedback ${canDispatchProducts() ? "info" : "error"}`;
  const dispatchActor = getDispatchActor();
  infoBlock.textContent = canDispatchProducts()
    ? `Despacho autorizado para ${dispatchActor?.name || "Operador"} (${formatCollaboratorRole(dispatchActor?.area || getSessionRole())}).`
    : getDispatchAccessMessage();

  exitForm.parentElement?.insertBefore(infoBlock, exitForm);

  const elements = [...exitForm.elements].filter(
    (element) => !(element instanceof HTMLButtonElement && element.type === "button"),
  );
  const allowDispatch = canDispatchProducts();

  elements.forEach((element) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLButtonElement
    ) {
      element.disabled = !allowDispatch;
    }
  });

  if (allowDispatch) {
    const footer = exitForm.querySelector(".field.full-span:last-child");
    if (footer && !exitForm.querySelector("[data-dispatch-operator]")) {
      const operatorField = document.createElement("div");
      operatorField.className = "field full-span";
      operatorField.dataset.dispatchOperator = "true";
      operatorField.innerHTML = `
        <label for="dispatch-operator-name">Despacho autorizado por</label>
        <input id="dispatch-operator-name" type="text" value="${escapeHtml(
          `${dispatchActor?.name || ""} · ${formatCollaboratorRole(dispatchActor?.area || getSessionRole())}`,
        )}" readonly />
      `;
      exitForm.insertBefore(operatorField, footer);
    }
  } else {
    exitForm.querySelector("[data-dispatch-operator]")?.remove();
  }
}

function hydratePendingAssignmentForm() {
  const assignmentForm = app.querySelector("#assignment-form");
  if (!(assignmentForm instanceof HTMLFormElement)) {
    return;
  }

  const productSelect = assignmentForm.querySelector("#assignment-product");
  const quantityField = assignmentForm.querySelector("#assignment-quantity");
  if (!(productSelect instanceof HTMLSelectElement) || !(quantityField instanceof HTMLInputElement)) {
    return;
  }

  const pendingProduct = ui.pendingAssignmentProductId
    ? getProductById(ui.pendingAssignmentProductId)
    : null;
  if (!pendingProduct) {
    return;
  }

  productSelect.value = pendingProduct.id;
  quantityField.value = String(pendingProduct.stockIdeal ?? "");
}

function hydrateProductFormState() {
  const productForm = app.querySelector("#product-form");
  if (!(productForm instanceof HTMLFormElement) || ui.editingProductId) {
    return;
  }

  if (!ui.productMatchId) {
    updateProductFormMatchHint(productForm, "");
    return;
  }

  const matchedProduct = getProductById(ui.productMatchId);
  if (!matchedProduct) {
    ui.productMatchId = "";
    updateProductFormMatchHint(productForm, "");
    return;
  }

  const nameField = productForm.querySelector("#product-name");
  if (nameField instanceof HTMLInputElement && !nameField.value.trim()) {
    nameField.value = matchedProduct.name;
  }

  syncProductFormFromName(productForm, matchedProduct.name);
}

function syncSessionWithCollaborators() {
  let shouldPersist = false;

  if (!session.authenticated) {
    return;
  }

  if (session.loginCollaboratorId) {
    const loginCollaborator = getCollaboratorById(session.loginCollaboratorId);
    const sessionLoginRole = normalizeCollaboratorRole(session.loginRole);
    const loginStillValid =
      Boolean(loginCollaborator) &&
      loginCollaborator.status === "active" &&
      normalizeCollaboratorRole(loginCollaborator.area) === sessionLoginRole &&
      COLLABORATOR_ROLES.some((role) => role.value === sessionLoginRole);

    if (!loginStillValid) {
      session.authenticated = false;
      session.loginRole = "";
      session.loginCollaboratorId = "";
      clearColdRoomAuthorization();
      clearOrdersAuthorization();
      ui.currentModule = "home";
      ui.coldRoomAccessPrompt = false;
      ui.ordersAccessPrompt = false;
      setFlash("login", "error", "El usuario autenticado ya no tiene acceso activo.");
      shouldPersist = true;
    }
  }

  if (!session.authenticated) {
    if (shouldPersist) {
      saveSession();
    }
    return;
  }

  if (session.activeCollaboratorId) {
    session.activeCollaboratorId = "";
    shouldPersist = true;
  }

  if (session.coldRoomAuthorized && !hasValidColdRoomAuthorization()) {
    clearColdRoomAuthorization();
    ui.coldRoomAccessPrompt = false;

    if (ui.currentModule === "cold-room") {
      ui.currentModule = "home";
      setFlash(
        "session",
        "info",
        "El acceso a Cuarto Frio se cerro porque la autorizacion del Encargado dejo de estar disponible.",
      );
    }

    shouldPersist = true;
  }

  if (session.ordersAuthorized && !hasValidOrdersAuthorization()) {
    clearOrdersAuthorization();
    ui.ordersAccessPrompt = false;

    if (ui.currentModule === "orders" && !hasOrdersBranchMembership()) {
      ui.currentModule = "home";
      setFlash(
        "session",
        "info",
        "El acceso autorizado a Pedidos se cerro porque la autorizacion administrativa dejo de estar disponible.",
      );
    }

    shouldPersist = true;
  }

  if (ui.currentModule === "orders" && !canAccessOrdersModule()) {
    ui.currentModule = "home";
    setFlash("session", "info", getOperatorAccessMessage("orders"));
  }

  if (ui.currentModule === "branches" && !canAccessBranchesModule()) {
    ui.currentModule = canAccessKitchenModule() ? "kitchen" : "home";
    setFlash("session", "info", getOperatorAccessMessage("branches"));
  }

  if (shouldPersist) {
    saveSession();
  }
}

function syncPresenceLifecycle() {
  const identity = getCurrentPresenceIdentity();
  const nextIdentityKey =
    session.authenticated && identity
      ? [identity.collaboratorId, normalizeCollaboratorRole(identity.role), ui.currentModule].join("|")
      : "";

  if (nextIdentityKey === presenceSync.identityKey) {
    return;
  }

  presenceSync.identityKey = nextIdentityKey;

  if (!nextIdentityKey) {
    void clearPresenceDocument();
    return;
  }

  void pushPresenceHeartbeat(true);
}

function getCurrentPresenceIdentity() {
  if (!session.authenticated) {
    return null;
  }

  if (session.loginCollaboratorId) {
    const loginCollaborator = getCollaboratorById(session.loginCollaboratorId);
    if (loginCollaborator && loginCollaborator.status === "active") {
      return {
        collaboratorId: loginCollaborator.id,
        name: loginCollaborator.name,
        role: normalizeCollaboratorRole(loginCollaborator.area),
      };
    }
  }

  if (session.coldRoomAccessCollaboratorId) {
    const coldRoomCollaborator = getCollaboratorById(session.coldRoomAccessCollaboratorId);
    if (coldRoomCollaborator && coldRoomCollaborator.status === "active") {
      return {
        collaboratorId: coldRoomCollaborator.id,
        name: coldRoomCollaborator.name,
        role: normalizeCollaboratorRole(coldRoomCollaborator.area),
      };
    }
  }

  return null;
}

async function pushPresenceHeartbeat(force = false) {
  const identity = getCurrentPresenceIdentity();

  if (!identity) {
    await clearPresenceDocument();
    return;
  }

  const presencePayload = {
    collaboratorId: identity.collaboratorId,
    name: identity.name,
    role: identity.role,
    module: ui.currentModule || "home",
    lastSeen: new Date().toISOString(),
  };

  const currentRecord = presenceSync.records.find((record) => record.sessionId === presenceSessionId);
  const currentSignature = currentRecord ? JSON.stringify(currentRecord) : "";
  const nextSignature = JSON.stringify({
    sessionId: presenceSessionId,
    ...presencePayload,
  });

  if (!force && currentSignature === nextSignature) {
    return;
  }

  try {
    await setDoc(doc(presenceCollectionRef, presenceSessionId), presencePayload);
  } catch (error) {
    console.error("Firestore presence write error:", error);
  }
}

async function clearPresenceDocument() {
  try {
    await deleteDoc(doc(presenceCollectionRef, presenceSessionId));
  } catch (error) {
    console.error("Firestore presence delete error:", error);
  }
}

function getActivePresenceRecords() {
  const now = Date.now();

  return presenceSync.records.filter((record) => {
    const lastSeenAt = new Date(record.lastSeen).getTime();
    if (!record.collaboratorId || Number.isNaN(lastSeenAt)) {
      return false;
    }

    if (now - lastSeenAt > PRESENCE_TTL_MS) {
      return false;
    }

    const collaborator = getCollaboratorById(record.collaboratorId);
    return Boolean(collaborator) && collaborator.status === "active";
  });
}

function getPresenceRenderSignature() {
  return getActivePresenceRecords()
    .map((record) =>
      [
        record.collaboratorId,
        normalizeCollaboratorRole(record.role),
        String(record.module || "").trim(),
      ].join("|"),
    )
    .sort()
    .join("||");
}

function refreshPresenceRenderState(force = false) {
  const nextSignature = getPresenceRenderSignature();

  if (!force && nextSignature === presenceSync.activeSignature) {
    return;
  }

  presenceSync.activeSignature = nextSignature;
  if (!shouldRenderPresenceChanges()) {
    return;
  }

  render();
}

function shouldRenderPresenceChanges() {
  if (ui.techPanelPrompt) {
    return true;
  }

  return ui.currentModule === "cold-room" && ui.coldRoomSection === "equipo";
}

function getOnlineCollaborators() {
  const activeMap = new Map();

  getActivePresenceRecords().forEach((record) => {
    const collaborator = getCollaboratorById(record.collaboratorId);
    if (!collaborator || activeMap.has(collaborator.id)) {
      return;
    }

    activeMap.set(collaborator.id, collaborator);
  });

  return [...activeMap.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function isCollaboratorOnline(collaboratorId) {
  return getActivePresenceRecords().some((record) => record.collaboratorId === collaboratorId);
}

function getActiveCollaborators() {
  return getSortedCollaborators().filter((collaborator) => collaborator.status === "active");
}

function getPrivilegedCollaborators() {
  return getActiveCollaborators().filter((collaborator) => {
    const role = normalizeCollaboratorRole(collaborator.area);
    return role === "encargado" || role === "administrador";
  });
}

function getCollaboratorsWithDirectLogin() {
  return getActiveCollaborators().filter((collaborator) => {
    const role = normalizeCollaboratorRole(collaborator.area);
    return Boolean(role) && Boolean(String(collaborator.password || "").trim());
  });
}

function getActiveAdministrators() {
  return getActiveCollaborators().filter(
    (collaborator) => normalizeCollaboratorRole(collaborator.area) === "administrador",
  );
}

function requiresCollaboratorPassword(role) {
  return COLLABORATOR_ROLES.some((item) => item.value === normalizeCollaboratorRole(role));
}

function getPasswordRequirementMessage(role) {
  const normalizedRole = normalizeCollaboratorRole(role);
  const roleLabel = formatCollaboratorRole(normalizedRole);
  return `Debes asignar una contrasena al ${roleLabel} para que pueda iniciar sesion con sus credenciales.`;
}

function getCredentialFieldConfig(role) {
  const normalizedRole = normalizeCollaboratorRole(role);

  if (normalizedRole === "administrador") {
    return {
      title: "Credenciales del Administrador",
      description:
        "Este usuario podra iniciar sesion desde la pantalla principal con su nombre y contrasena, y tendra acceso para revisar todos los movimientos del sistema.",
      label: "Asignar contrasena de acceso",
      placeholder: "Crea la contrasena del Administrador",
      hint: "El usuario iniciara sesion con su nombre exacto y esta contrasena.",
    };
  }

  if (normalizedRole === "encargado") {
    return {
      title: "Credenciales del Encargado",
      description:
        "Esta clave se usa para abrir Cuarto Frio y habilitar el despacho de mercancia como Encargado.",
      label: "Asignar contrasena",
      placeholder: "Crea la contrasena del Encargado",
      hint: "Solo el Encargado usara esta contrasena para abrir Cuarto Frio.",
    };
  }

  if (normalizedRole === "lider_de_turno") {
    return {
      title: "Credenciales del Lider de turno",
      description:
        "Este usuario podra iniciar sesion con su nombre y contrasena para actualizar el stock real de tienda en su sucursal.",
      label: "Asignar contrasena",
      placeholder: "Crea la contrasena del Lider de turno",
      hint: "Solo el Lider de turno de la sucursal podra editar el Stock de tienda.",
    };
  }

  if (normalizedRole === "cocinero") {
    return {
      title: "Credenciales del Cocinero",
      description:
        "Este usuario podra iniciar sesion con su nombre y contrasena, y tendra acceso operativo solo al modulo Cocina.",
      label: "Asignar contrasena",
      placeholder: "Crea la contrasena del Cocinero",
      hint: "El Cocinero podra entrar al login principal y trabajar solo desde Cocina.",
    };
  }

  if (normalizedRole === "utility") {
    return {
      title: "Credenciales del Utility",
      description:
        "Este usuario podra iniciar sesion con su nombre y contrasena, y tendra acceso operativo solo al modulo Cocina.",
      label: "Asignar contrasena",
      placeholder: "Crea la contrasena del Utility",
      hint: "El Utility podra entrar al login principal y trabajar solo desde Cocina.",
    };
  }

  return null;
}

function isBootstrapMode() {
  return getPrivilegedCollaborators().length === 0;
}

function getActiveStoreManager() {
  return (
    getActiveCollaborators().find(
      (collaborator) => normalizeCollaboratorRole(collaborator.area) === "encargado",
    ) || null
  );
}

function clearColdRoomAuthorization() {
  session.coldRoomAuthorized = false;
  session.coldRoomAccessRole = "";
  session.coldRoomAccessCollaboratorId = "";
}

function clearOrdersAuthorization() {
  session.ordersAuthorized = false;
  session.ordersAccessCollaboratorId = "";
}

function hasValidColdRoomAuthorization() {
  if (!session.coldRoomAuthorized) {
    return false;
  }

  if (session.coldRoomAccessRole === "administrador") {
    return true;
  }

  if (session.coldRoomAccessRole !== "encargado") {
    return false;
  }

  const collaborator = getCollaboratorById(session.coldRoomAccessCollaboratorId);
  return (
    Boolean(collaborator) &&
    collaborator.status === "active" &&
    normalizeCollaboratorRole(collaborator.area) === "encargado"
  );
}

function hasValidOrdersAuthorization() {
  if (!session.ordersAuthorized) {
    return false;
  }

  if (!session.ordersAccessCollaboratorId) {
    return true;
  }

  const collaborator = getCollaboratorById(session.ordersAccessCollaboratorId);
  return (
    Boolean(collaborator) &&
    collaborator.status === "active" &&
    normalizeCollaboratorRole(collaborator.area) === "administrador"
  );
}

function resolveAdministratorPassword(password) {
  if (!password) {
    return null;
  }

  if (password === CREDENTIALS.password) {
    return {
      id: "",
      name: CREDENTIALS.username,
      role: "administrador",
    };
  }

  const administrator = getActiveAdministrators().find(
    (collaborator) => collaborator.password && collaborator.password === password,
  );

  if (!administrator) {
    return null;
  }

  return {
    id: administrator.id,
    name: administrator.name,
    role: "administrador",
  };
}

function resolveLoginAccess(username, password) {
  if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
    return {
      role: "administrador",
      collaboratorId: "",
      autoAuthorizeColdRoom: true,
    };
  }

  const directLoginCollaborator = getCollaboratorsWithDirectLogin().find(
    (collaborator) =>
      collaborator.name.localeCompare(username, "es", { sensitivity: "base" }) === 0 &&
      collaborator.password === password,
  );

  if (!directLoginCollaborator) {
    return null;
  }

  const collaboratorRole = normalizeCollaboratorRole(directLoginCollaborator.area);

  return {
    role: collaboratorRole,
    collaboratorId: directLoginCollaborator.id,
    autoAuthorizeColdRoom: collaboratorRole === "administrador" || collaboratorRole === "encargado",
  };
}

function resolveColdRoomAccess(password) {
  if (password === CREDENTIALS.password) {
    return {
      role: "administrador",
      collaboratorId: "",
    };
  }

  const activeAdministrator = getActiveAdministrators().find(
    (collaborator) => collaborator.password && collaborator.password === password,
  );
  if (activeAdministrator) {
    return {
      role: "administrador",
      collaboratorId: activeAdministrator.id,
    };
  }

  const activeStoreManager = getActiveStoreManager();
  if (
    activeStoreManager &&
    activeStoreManager.password &&
    password &&
    activeStoreManager.password === password
  ) {
    return {
      role: "encargado",
      collaboratorId: activeStoreManager.id,
    };
  }

  return null;
}

function getSessionOperator() {
  if (session.coldRoomAccessRole !== "encargado") {
    return null;
  }

  return getCollaboratorById(session.coldRoomAccessCollaboratorId);
}

function getSessionRole() {
  return hasValidColdRoomAuthorization() ? normalizeCollaboratorRole(session.coldRoomAccessRole) : "";
}

function requiresOperatorSelection() {
  return false;
}

function canAccessKitchenModule() {
  return session.authenticated === true && !isTurnLeaderRole();
}

function canAccessOrdersModule() {
  return session.authenticated === true && getLoginRole() === "administrador";
}

function canAccessBranchesModule() {
  return session.authenticated === true && !isKitchenOnlyRole();
}

function canAccessColdRoomModule() {
  return !isTurnLeaderRole() && hasValidColdRoomAuthorization();
}

function hasOrdersBranchMembership() {
  const collaborator = getAuthenticatedCollaborator();
  if (!collaborator) {
    return false;
  }

  return Boolean(normalizeCollaboratorBranch(collaborator.branch));
}

function isMasterUserSession() {
  return (
    session.authenticated &&
    !session.loginCollaboratorId &&
    normalizeCollaboratorRole(session.loginRole) === "administrador"
  );
}

function canDispatchProducts() {
  if (!canAccessColdRoomModule()) {
    return false;
  }

  if (isMasterUserSession()) {
    return true;
  }

  return getSessionRole() === "encargado" && Boolean(getSessionOperator());
}

function canManageKitchenProductCatalog() {
  if (!session.authenticated) {
    return false;
  }

  return canAccessColdRoomModule() && !isKitchenOnlyRole();
}

function getAccessibleBranches() {
  const collaborator = getAuthenticatedCollaborator();

  if (!collaborator || normalizeCollaboratorRole(collaborator.area) !== "lider_de_turno") {
    return BRANCH_LOCATIONS;
  }

  const assignedBranch = normalizeCollaboratorBranch(collaborator.branch);
  if (assignedBranch === ALL_BRANCHES_OPTION) {
    return BRANCH_LOCATIONS;
  }
  return BRANCH_LOCATIONS.filter((branch) => normalizeCollaboratorBranch(branch.name) === assignedBranch);
}

function getKitchenAccessibleBranches() {
  const collaborator = getAuthenticatedCollaborator();

  if (!collaborator) {
    return BRANCH_LOCATIONS;
  }

  const collaboratorRole = normalizeCollaboratorRole(collaborator.area);

  if (collaboratorRole === "cocinero" || collaboratorRole === "utility") {
    const assignedBranch = normalizeCollaboratorBranch(collaborator.branch);
    if (!assignedBranch) {
      return [];
    }

    if (assignedBranch === ALL_BRANCHES_OPTION) {
      return BRANCH_LOCATIONS;
    }

    return BRANCH_LOCATIONS.filter((branch) => normalizeCollaboratorBranch(branch.name) === assignedBranch);
  }

  return getAccessibleBranches();
}

function canAccessBranch(branchId) {
  return getAccessibleBranches().some((branch) => branch.id === String(branchId || ""));
}

function canAccessKitchenBranch(branchId) {
  return getKitchenAccessibleBranches().some((branch) => branch.id === String(branchId || ""));
}

function getAuthenticatedCollaborator() {
  if (!session.authenticated || !session.loginCollaboratorId) {
    return null;
  }

  const collaborator = getCollaboratorById(session.loginCollaboratorId);
  return collaborator && collaborator.status === "active" ? collaborator : null;
}

function getAuthenticatedIdentity() {
  if (!session.authenticated) {
    return null;
  }

  if (isMasterUserSession()) {
    return {
      id: "",
      name: CREDENTIALS.username,
      role: "administrador",
      branch: "",
    };
  }

  const collaborator = getAuthenticatedCollaborator();
  if (!collaborator) {
    return null;
  }

  return {
    id: collaborator.id,
    name: collaborator.name,
    role: normalizeCollaboratorRole(collaborator.area),
    branch: normalizeCollaboratorBranch(collaborator.branch),
  };
}

function getLoginRole() {
  return normalizeCollaboratorRole(getAuthenticatedIdentity()?.role || session.loginRole);
}

function isKitchenOnlyRole(role = getLoginRole()) {
  const normalizedRole = normalizeCollaboratorRole(role);
  return normalizedRole === "cocinero" || normalizedRole === "utility";
}

function isTurnLeaderRole(role = getLoginRole()) {
  return normalizeCollaboratorRole(role) === "lider_de_turno";
}

function getDispatchActor() {
  if (isMasterUserSession()) {
    return {
      id: "",
      name: CREDENTIALS.username,
      area: "administrador",
    };
  }

  return getSessionOperator();
}

function getActiveTurnLeaderByBranch(branchName) {
  const normalizedBranch = normalizeCollaboratorBranch(branchName);
  if (!normalizedBranch) {
    return null;
  }

  return (
    getActiveCollaborators().find(
      (collaborator) =>
        normalizeCollaboratorRole(collaborator.area) === "lider_de_turno" &&
        (normalizeCollaboratorBranch(collaborator.branch) === normalizedBranch ||
          normalizeCollaboratorBranch(collaborator.branch) === ALL_BRANCHES_OPTION),
    ) || null
  );
}

function requiresLeaderPasswordForKitchenOrder() {
  return isKitchenOnlyRole();
}

function getKitchenOrderRequestedQuantity(record, product) {
  if (!product) {
    return 0;
  }

  return getBranchProductOrderQuantity(record, product);
}

function getKitchenOrderDraftItems(branchId, brandName) {
  const record = getBranchNeedRecord(branchId, brandName);

  return record.productIds
    .map((productId) => {
      const product = getProductById(productId);
      if (!product) {
        return null;
      }

      const requested = getKitchenOrderRequestedQuantity(record, product);
      if (requested <= 0) {
        return null;
      }

      return {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        requested,
        delivered: 0,
        pending: requested,
        workedInKitchen: false,
        workedAt: "",
      };
    })
    .filter(Boolean);
}

function resolveTurnLeaderPasswordForBranch(branchId, password) {
  const branch = getBranchLocationById(branchId);
  const leader = branch ? getActiveTurnLeaderByBranch(branch.name) : null;

  if (!leader || !leader.password || !password || leader.password !== password) {
    return null;
  }

  return leader;
}

function getKitchenOrderAccess(branchId, brandName) {
  const branch = getBranchLocationById(branchId);
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const record = getBranchNeedRecord(branchId, normalizedBrandName);
  const selectedCount = countRequestableBranchProducts(record);
  const draftItems = getKitchenOrderDraftItems(branchId, normalizedBrandName);
  const leader = branch ? getActiveTurnLeaderByBranch(branch.name) : null;

  if (!branch || !normalizedBrandName) {
    return {
      allowed: false,
      requiresLeaderPassword: false,
      draftItems: [],
      message: "No se pudo identificar la sucursal o la marca de este pedido.",
    };
  }

  if (selectedCount === 0) {
    return {
      allowed: false,
      requiresLeaderPassword: requiresLeaderPasswordForKitchenOrder(),
      draftItems,
      message: "Marca al menos un producto para preparar el pedido de esta marca.",
    };
  }

  if (draftItems.length === 0) {
    return {
      allowed: false,
      requiresLeaderPassword: requiresLeaderPasswordForKitchenOrder(),
      draftItems,
      message:
        "Los productos marcados ya estan abastecidos. Ajusta el stock de tienda o marca productos con faltante real.",
    };
  }

  if (!requiresLeaderPasswordForKitchenOrder()) {
    return {
      allowed: true,
      requiresLeaderPassword: false,
      draftItems,
      message: "Puedes enviar este pedido directamente a Cocina y dejarlo listo para imprimir.",
    };
  }

  if (!leader || !leader.password) {
    return {
      allowed: false,
      requiresLeaderPassword: true,
      draftItems,
      message: `Debes registrar un Lider de turno activo con contrasena en ${branch.name} para autorizar este pedido.`,
    };
  }

  return {
    allowed: true,
    requiresLeaderPassword: true,
    draftItems,
    message: `Para enviar el pedido de ${branch.name} / ${normalizedBrandName}, necesitas la contrasena de ${leader.name}.`,
  };
}

function createKitchenOrderNumber() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(2, 12);
  const suffix = Math.floor(100 + Math.random() * 900);
  return `REQ-${stamp}-${suffix}`;
}

function getSortedKitchenOrders() {
  return [...state.kitchenOrders].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function getKitchenOrderById(orderId) {
  return state.kitchenOrders.find((order) => order.id === orderId) || null;
}

function deleteKitchenOrder(orderId) {
  console.log("deleteKitchenOrder called with:", orderId);
  const order = getKitchenOrderById(orderId);

  if (!order) {
    console.log("Order not found:", orderId);
    setFlash("kitchen-orders", "error", "No se encontro el pedido que intentabas eliminar.");
    render();
    return;
  }

  console.log("Order found, moving to history:", order.number);
  // Cambiar estado a "completada" en lugar de eliminar
  order.status = "completada";
  order.completedAt = new Date().toISOString();
  order.completedBy = getAuthenticatedCollaborator()?.name || "Sistema";
  
  reconcileNotificationsWithInventory();
  saveState();
  setFlash("kitchen-orders", "success", `Pedido ${order.number} movido al historial.`);
  render();
}

function forwardKitchenOrderToDispatch(orderId) {
  const order = getKitchenOrderById(orderId);

  if (!order) {
    setFlash("kitchen-orders", "error", "No se encontro el pedido que querias enviar al encargado.");
    render();
    return;
  }

  const branch = getBranchLocationById(order.branchId);
  const normalizedBrandName = normalizeBranchBrand(order.brandName);

  if (!branch || !normalizedBrandName) {
    setFlash("kitchen-orders", "error", "No se pudo identificar la sucursal de este pedido.");
    render();
    return;
  }

  const branchNeed = getBranchNeedRecord(order.branchId, normalizedBrandName);
  order.items.forEach((item) => {
    const product = getProductById(item.productId);
    if (!product) {
      item.requested = roundStock(item.delivered);
      item.pending = 0;
      return;
    }

    const currentOrderQuantity = getBranchProductOrderQuantity(branchNeed, product);
    item.requested = roundStock(item.delivered + currentOrderQuantity);
    item.pending = currentOrderQuantity;
  });

  if (isKitchenOrderFullyDispatched(order)) {
    order.status = "completada";
    order.forwardedToDispatch = false;
    order.forwardedAt = "";
    order.forwardedById = "";
    order.forwardedByName = "";
    order.forwardedByRole = "";
    reconcileNotificationsWithInventory();
    saveState();
    setFlash(
      "kitchen-orders",
      "info",
      `El pedido ${order.number} ya no tiene cantidades pendientes para enviar al encargado.`,
    );
    render();
    return;
  }

  const sender = getAuthenticatedIdentity();
  order.forwardedToDispatch = true;
  order.forwardedAt = new Date().toISOString();
  order.forwardedById = sender?.id || "";
  order.forwardedByName = sender?.name || CREDENTIALS.username;
  order.forwardedByRole = normalizeCollaboratorRole(sender?.role || "administrador");
  order.status = "pendiente";
  order.sentToKitchen = false;
  order.sentToKitchenAt = "";
  order.sentToKitchenById = "";
  order.sentToKitchenByName = "";
  order.sentToKitchenByRole = "";

  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "kitchen-orders",
    "success",
    isKitchenOrderFullyDispatched(order)
      ? `Pedido ${order.number} revisado. Ya no habia cantidades pendientes para despachar.`
      : `Pedido ${order.number} enviado al encargado. Ya aparece en Salida de Productos listo para dar salida.`,
  );
  render();
}

function dispatchKitchenOrder(orderId) {
  if (!canDispatchProducts()) {
    setFlash("dispatch-queue", "error", getDispatchAccessMessage());
    render();
    return;
  }

  const order = getKitchenOrderById(orderId);
  if (!order) {
    setFlash("dispatch-queue", "error", "No se encontro el pedido que intentabas despachar.");
    render();
    return;
  }

  const branch = getBranchLocationById(order.branchId);
  const normalizedBrandName = normalizeBranchBrand(order.brandName);
  if (!branch || !normalizedBrandName) {
    setFlash("dispatch-queue", "error", "No se pudo identificar la sucursal o la marca de este pedido.");
    render();
    return;
  }

  const actor = getDispatchActor();
  const actorName = actor?.name || CREDENTIALS.username;
  const authorizationNote = `Autorizado por ${actorName} el ${formatDate(today())}.`;
  const dispatchLines = [];

  for (const item of order.items) {
    const product = getProductById(item.productId);
    if (!product) {
      continue;
    }

    const liveBranchNeed = getBranchNeedRecord(order.branchId, normalizedBrandName);
    const currentStoreStock = getBranchProductStoreStock(liveBranchNeed, product.id);
    const currentOrderQuantity =
      currentStoreStock === null
        ? roundStock(Math.max(normalizeNumber(item.pending, item.requested), 0))
        : getBranchProductOrderQuantity(liveBranchNeed, product);
    
    // Para pedidos "Listo para salida", usar la cantidad entregada configurada
    const requestedPending = order.forwardedToDispatch 
      ? roundStock(Math.max(normalizeNumber(item.delivered, 0), 0))
      : roundStock(Math.max(normalizeNumber(item.pending, item.requested), 0));
    
    const dispatchQuantity =
      currentStoreStock === null
        ? requestedPending
        : roundStock(Math.min(requestedPending, currentOrderQuantity));

    if (dispatchQuantity <= 0) {
      item.pending = 0;
      continue;
    }

    if (dispatchQuantity > product.stockCurrent) {
      setFlash(
        "dispatch-queue",
        "error",
        `No puedes dar salida al pedido ${order.number} porque ${product.name} solo tiene ${formatNumber(product.stockCurrent)} ${product.unit} disponibles.`,
      );
      render();
      return;
    }

    dispatchLines.push({
      item,
      product,
      dispatchQuantity,
      destination: formatBranchDestination(branch, normalizedBrandName),
    });
  }

  if (dispatchLines.length === 0) {
    order.status = "completada";
    reconcileNotificationsWithInventory();
    saveState();
    setFlash("dispatch-queue", "info", `El pedido ${order.number} ya no tenia cantidades pendientes para despachar.`);
    render();
    return;
  }

  for (const { item, product, dispatchQuantity, destination } of dispatchLines) {
    const exitResult = registerProductExitOperation({
      productId: product.id,
      quantity: dispatchQuantity,
      destination,
      date: today(),
      observation: authorizationNote,
      dispatchActor: actor,
    });

    if (!exitResult.ok) {
      setFlash("dispatch-queue", "error", exitResult.error);
      render();
      return;
    }

    const linkedNotification = state.notifications.find(
      (notification) => notification.id === exitResult.notificationId,
    );
    if (linkedNotification) {
      linkedNotification.sourceOrderId = order.id;
    }

    const currentStoreStock = getBranchProductStoreStock(getBranchStorageRecord(order.branchId), product.id);
    const nextStoreStock = roundStock((currentStoreStock === null ? 0 : currentStoreStock) + dispatchQuantity);
    setBranchStoreStockValue(order.branchId, product.id, nextStoreStock, new Date().toISOString());

    item.delivered = roundStock(item.delivered + dispatchQuantity);
    item.pending = roundStock(Math.max(item.requested - item.delivered, 0));
  }

  order.status = isKitchenOrderFullyDispatched(order) ? "completada" : "en_progreso";
  order.sentToKitchen = false;
  order.sentToKitchenAt = "";
  order.sentToKitchenById = "";
  order.sentToKitchenByName = "";
  order.sentToKitchenByRole = "";

  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "dispatch-queue",
    "success",
    `Salida automatica registrada para el pedido ${order.number}. El inventario se desconto y Cocina recibira el faltante consolidado por producto.`,
  );
  render();
}

function dispatchBranchNotification(notificationId) {
  if (!canDispatchProducts()) {
    setFlash("notifications", "error", getDispatchAccessMessage());
    render();
    return;
  }

  const notification = state.notifications.find((item) => item.id === notificationId);
  if (!notification) {
    setFlash("notifications", "error", "La notificacion que intentabas despachar ya no esta disponible.");
    render();
    return;
  }

  if (normalizeNotificationSourceType(notification.sourceType, notification) !== "branch_stock") {
    setFlash("notifications", "error", "Solo las solicitudes de tienda se despachan con Dar salida.");
    render();
    return;
  }

  const branch = getBranchLocationById(notification.branchId);
  const normalizedBrandName = normalizeBranchBrand(notification.brandName);
  const product = getProductById(notification.productId);
  const branchNeed = getBranchNeedRecord(notification.branchId, normalizedBrandName);

  if (!branch || !normalizedBrandName || !product) {
    notification.status = "completada";
    notification.completedAt = notification.completedAt || new Date().toISOString();
    saveState();
    setFlash("notifications", "info", "La solicitud se cerro porque ya no tiene un contexto valido.");
    render();
    return;
  }

  const dispatchQuantity = getBranchProductRequestShortage(branchNeed, product);
  if (dispatchQuantity <= 0) {
    notification.status = "completada";
    notification.completedAt = notification.completedAt || new Date().toISOString();
    reconcileNotificationsWithInventory();
    saveState();
    setFlash("notifications", "info", "Esa tienda ya esta abastecida, por lo que no hacia falta dar salida.");
    render();
    return;
  }

  const exitResult = registerProductExitOperation({
    productId: product.id,
    quantity: dispatchQuantity,
    destination: formatBranchDestination(branch, normalizedBrandName),
    date: today(),
    observation: `Salida automatica desde pedido ${notification.sourceOrderId || notification.id}.`,
    dispatchActor: getDispatchActor(),
  });

  if (!exitResult.ok) {
    setFlash("notifications", "error", exitResult.error);
    render();
    return;
  }

  const currentStoreStock = getBranchProductStoreStock(getBranchStorageRecord(notification.branchId), product.id);
  const nextStoreStock = roundStock((currentStoreStock === null ? 0 : currentStoreStock) + dispatchQuantity);
  setBranchStoreStockValue(notification.branchId, product.id, nextStoreStock, new Date().toISOString());

  const targetOrder =
    getKitchenOrderById(notification.sourceOrderId) ||
    state.kitchenOrders.find(
      (order) =>
        order.branchId === notification.branchId &&
        normalizeBranchBrand(order.brandName) === normalizedBrandName &&
        Array.isArray(order.items) &&
        order.items.some((item) => item.productId === product.id),
    ) ||
    null;

  if (targetOrder) {
    const targetItem = targetOrder.items.find((item) => item.productId === product.id);
    if (targetItem) {
      targetItem.requested = roundStock(targetItem.delivered + dispatchQuantity);
      targetItem.pending = dispatchQuantity;
      targetItem.delivered = roundStock(targetItem.delivered + dispatchQuantity);
      targetItem.pending = roundStock(Math.max(targetItem.requested - targetItem.delivered, 0));
    }

    targetOrder.status = isKitchenOrderFullyDispatched(targetOrder) ? "completada" : "pendiente";
  }

  notification.quantity = dispatchQuantity;
  notification.sourceHistoryId = exitResult.historyId;
  notification.status = "completada";
  notification.completedAt = new Date().toISOString();

  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "notifications",
    "success",
    `Salida registrada para ${product.name}. Se enviaron ${formatNumber(dispatchQuantity)} ${product.unit} a ${branch.name} / ${normalizedBrandName}.`,
  );
  render();
}

function closeKitchenOrderPrompt() {
  ui.kitchenOrderPrompt = false;
  ui.kitchenOrderPromptBranchId = "";
  ui.kitchenOrderPromptBrandName = "";
}

function requestKitchenOrder(branchId, brandName) {
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const access = getKitchenOrderAccess(branchId, normalizedBrandName);

  if (!access.allowed) {
    setFlash("branches", "error", access.message);
    render();
    return;
  }

  if (access.requiresLeaderPassword) {
    ui.kitchenOrderPrompt = true;
    ui.kitchenOrderPromptBranchId = branchId;
    ui.kitchenOrderPromptBrandName = normalizedBrandName;
    ui.flash = null;
    render();
    return;
  }

  finalizeKitchenOrderSubmission(branchId, normalizedBrandName, getAuthenticatedIdentity());
}

function submitKitchenOrderAuthorization(form) {
  const branchId = ui.kitchenOrderPromptBranchId;
  const brandName = normalizeBranchBrand(ui.kitchenOrderPromptBrandName);
  const password = String(new FormData(form).get("password") || "");
  const leader = resolveTurnLeaderPasswordForBranch(branchId, password);

  if (!leader) {
    setFlash(
      "kitchen-order-auth",
      "error",
      "La contrasena no coincide con el Lider de turno activo de esta sucursal.",
    );
    render();
    return;
  }

  finalizeKitchenOrderSubmission(branchId, brandName, {
    id: leader.id,
    name: leader.name,
    role: normalizeCollaboratorRole(leader.area),
    branch: normalizeCollaboratorBranch(leader.branch),
  });
}

function finalizeKitchenOrderSubmission(branchId, brandName, authorizedBy) {
  const branch = getBranchLocationById(branchId);
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const requester = getAuthenticatedIdentity();
  const draftItems = getKitchenOrderDraftItems(branchId, normalizedBrandName);

  if (!branch || !normalizedBrandName || !requester) {
    setFlash("branches", "error", "No se pudo preparar el pedido de Cocina.");
    render();
    return;
  }

  if (draftItems.length === 0) {
    closeKitchenOrderPrompt();
    setFlash(
      "branches",
      "error",
      "No hay cantidades pendientes para enviar. Revisa el stock de tienda antes de generar el pedido.",
    );
    render();
    return;
  }

  const createdAt = new Date().toISOString();
  const order = {
    id: createId("kitchen-order"),
    number: createKitchenOrderNumber(),
    branchId: branch.id,
    branchName: branch.name,
    brandName: normalizedBrandName,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterRole: requester.role,
    authorizedById: authorizedBy?.id || requester.id,
    authorizedByName: authorizedBy?.name || requester.name,
    authorizedByRole: normalizeCollaboratorRole(authorizedBy?.role || requester.role),
    origin: "Cuarto Frio",
    destination: `${branch.name} / ${normalizedBrandName}`,
    status: "pendiente",
    date: today(),
    createdAt,
    forwardedToDispatch: false,
    forwardedAt: "",
    forwardedById: "",
    forwardedByName: "",
    forwardedByRole: "",
    sentToKitchen: false,
    sentToKitchenAt: "",
    sentToKitchenById: "",
    sentToKitchenByName: "",
    sentToKitchenByRole: "",
    items: draftItems,
  };

  state.kitchenOrders.unshift(order);
  state.branchNeeds = state.branchNeeds.map((branchNeed) => {
    if (
      branchNeed.branchId !== branch.id ||
      normalizeBranchBrand(branchNeed.brandName) !== normalizedBrandName
    ) {
      return branchNeed;
    }

    return {
      ...branchNeed,
      productIds: [],
      updatedAt: createdAt,
    };
  });

  closeKitchenOrderPrompt();
  ui.currentModule = "kitchen";
  ui.kitchenSection = "panel";
  ui.selectedKitchenBranchId = "";
  ui.selectedKitchenBrand = "";
  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "kitchen-orders",
    "success",
    `Pedido ${order.number} enviado para ${branch.name} / ${normalizedBrandName}. Ya puedes imprimirlo desde Cocina.`,
  );
  render();
}

function printKitchenOrder(orderId) {
  const order = getKitchenOrderById(orderId);

  if (!order) {
    setFlash("kitchen-orders", "error", "No se encontro el pedido que intentabas imprimir.");
    render();
    return;
  }

  const printWindow = window.open(
    "",
    `print-kitchen-order-${order.id}`,
    "width=1180,height=860,resizable=yes,scrollbars=yes",
  );
  if (!printWindow) {
    setFlash(
      "kitchen-orders",
      "error",
      "El navegador bloqueo la ventana de impresion. Habilita las ventanas emergentes e intenta otra vez.",
    );
    render();
    return;
  }

  printWindow.document.open();
  printWindow.document.write(buildKitchenOrderPrintMarkup(order));
  printWindow.document.close();
  window.setTimeout(() => {
    try {
      printWindow.focus();
    } catch (error) {
      console.error("Print preview focus error:", error);
    }
  }, 120);
}

function buildKitchenOrderPrintMarkup(order) {
  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.unit || "unid.")}</td>
          <td>${formatNumber(item.requested)}</td>
          <td>${formatNumber(item.delivered)}</td>
          <td>${formatNumber(item.pending)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(order.number)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #111;
            background: #eef1ea;
          }
          .preview-actions {
            position: sticky;
            top: 0;
            z-index: 5;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 18px;
            margin: 0 auto 18px;
            max-width: 980px;
            border-radius: 18px;
            background: rgba(20, 35, 24, 0.92);
            color: #f7fbf7;
            box-shadow: 0 16px 40px rgba(11, 20, 14, 0.18);
          }
          .preview-actions-copy {
            display: grid;
            gap: 4px;
          }
          .preview-actions-copy strong {
            font-size: 1rem;
          }
          .preview-actions-copy span {
            font-size: 0.88rem;
            opacity: 0.82;
          }
          .preview-actions-buttons {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 10px;
          }
          .preview-actions button {
            border: 0;
            border-radius: 999px;
            padding: 11px 18px;
            font-size: 0.92rem;
            font-weight: 700;
            cursor: pointer;
          }
          .preview-actions .print-btn {
            background: #2f6c47;
            color: #fff;
          }
          .preview-actions .close-btn {
            background: #f5f2e8;
            color: #203126;
          }
          .sheet {
            max-width: 980px;
            margin: 0 auto;
            padding: 28px;
            border-radius: 24px;
            background: #fff;
            box-shadow: 0 24px 70px rgba(13, 22, 15, 0.12);
          }
          .sheet-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 24px;
            margin-bottom: 20px;
          }
          .sheet-head h1 {
            margin: 0 0 10px;
            font-size: 30px;
            font-weight: 700;
          }
          .sheet-meta {
            display: grid;
            gap: 4px;
            font-size: 15px;
          }
          .sheet-code {
            min-width: 220px;
            text-align: right;
            font-size: 14px;
          }
          .sheet-barcode {
            display: inline-block;
            padding: 10px 14px;
            margin-bottom: 10px;
            border: 1px solid #111;
            letter-spacing: 0.3em;
            font-weight: 700;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 18px;
            font-size: 14px;
          }
          th, td {
            border: 1px solid #222;
            padding: 8px 10px;
            text-align: left;
          }
          th {
            background: #f1f1f1;
          }
          @media print {
            .preview-actions {
              display: none;
            }
            body {
              padding: 0;
              background: #fff;
            }
            .sheet {
              padding: 0;
              border-radius: 0;
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="preview-actions">
          <div class="preview-actions-copy">
            <strong>Vista previa del pedido ${escapeHtml(order.number)}</strong>
            <span>Usa este panel para revisar el formato antes de imprimir.</span>
          </div>
          <div class="preview-actions-buttons">
            <button class="print-btn" type="button" onclick="window.print()">Imprimir ahora</button>
            <button class="close-btn" type="button" onclick="window.close()">Cerrar</button>
          </div>
        </div>
        <div class="sheet">
          <div class="sheet-head">
            <div>
              <h1>Requisicion de Inventario</h1>
              <div class="sheet-meta">
                <div><strong>No.:</strong> ${escapeHtml(order.number)}</div>
                <div><strong>Solicitante:</strong> ${escapeHtml(order.requesterName || "Sin solicitante")}</div>
                <div><strong>Necesario para:</strong> ${escapeHtml(`${order.branchName} / ${order.brandName}`)}</div>
                <div><strong>Origen:</strong> ${escapeHtml(order.origin || "Cuarto Frio")}</div>
                <div><strong>Destino:</strong> ${escapeHtml(order.destination || `${order.branchName} / ${order.brandName}`)}</div>
                <div><strong>Estado:</strong> ${escapeHtml(order.status || "Pendiente")}</div>
                <div><strong>Autorizado por:</strong> ${escapeHtml(order.authorizedByName || "Sin autorizacion")}</div>
                <div><strong>Fecha:</strong> ${escapeHtml(formatDate(order.date))}</div>
              </div>
            </div>
            <div class="sheet-code">
              <div class="sheet-barcode">${escapeHtml(order.number)}</div>
              <div>${escapeHtml(order.number)}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Unidad</th>
                <th>Solicitado</th>
                <th>Entregado</th>
                <th>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

// Nuevas funciones para el sistema de gestión de pedidos
function viewOrderModal(orderId) {
  const order = getKitchenOrderById(orderId);
  
  if (!order) {
    setFlash("kitchen-orders", "error", "No se encontró el pedido.");
    render();
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-window modal-order-sheet">
      <div class="modal-card">
        <div class="modal-header">
          <h2>Ver Pedido ${escapeHtml(order.number)}</h2>
          <button class="btn btn-ghost btn-small" data-action="close-modal">Cerrar</button>
        </div>
        <div class="modal-body">
          <div class="sheet-meta">
            <p><strong>Sucursal:</strong> ${escapeHtml(order.branchName)} / ${escapeHtml(order.brandName)}</p>
            <p><strong>Fecha:</strong> ${escapeHtml(formatDate(order.date))}</p>
            <p><strong>Solicitante:</strong> ${escapeHtml(order.requesterName || "Sin solicitante")}</p>
            <p><strong>Autorizado por:</strong> ${escapeHtml(order.authorizedByName || "Sin autorización")}</p>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th>Solicitado</th>
                  <th>Entregado</th>
                  <th>Pendiente</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${order.items.map(item => `
                  <tr class="${item.unavailable ? 'producto-no-disponible' : ''}">
                    <td>${escapeHtml(item.productName)}</td>
                    <td>${escapeHtml(item.unit || "unid.")}</td>
                    <td>${formatNumber(item.requested)}</td>
                    <td>
                      <input type="number" 
                             value="${formatNumber(item.delivered)}" 
                             class="input-entregado" 
                             data-order-id="${escapeHtml(order.id)}" 
                             data-product-id="${escapeHtml(item.productId)}" 
                             min="0"
                             ${order.sentToBranch ? 'disabled' : ''}>
                    </td>
                    <td>${formatNumber(item.pending)}</td>
                    <td>
                      <button class="btn-x" 
                              data-action="mark-unavailable" 
                              data-order-id="${escapeHtml(order.id)}" 
                              data-product-id="${escapeHtml(item.productId)}" 
                              data-product-name="${escapeHtml(item.productName)}"
                              ${order.sentToBranch ? 'disabled' : ''}>
                        X
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="sheet-meta" style="margin-top: 1rem; padding: 1rem; background: var(--bg-soft); border-radius: var(--radius-md);">
            <p><strong>💡 Nota:</strong> La cantidad en "Entregado" representa lo que realmente se va a despachar del inventario.</p>
            ${order.forwardedToDispatch ? `
              <p><strong>📦 Estado:</strong> Listo para salida - Puedes ajustar las cantidades antes de despachar.</p>
            ` : ''}
          </div>
          ${getOrderIncidents(order).length > 0 ? `
            <div class="incidente-list">
              <h4>⚠️ Incidencias detectadas:</h4>
              <ul>
                ${getOrderIncidents(order).map(incident => `
                  <li>${escapeHtml(incident)}</li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
        <div class="modal-actions">
          ${order.forwardedToDispatch && !order.sentToBranch ? `
            <button class="btn btn-success" data-action="send-to-branch" data-id="${escapeHtml(order.id)}">
              Enviar a sucursal
            </button>
          ` : ''}
          <button class="btn btn-primary" data-action="print-kitchen-order" data-id="${escapeHtml(order.id)}">
            Imprimir pedido
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  // Añadir event listener específico para este modal
  modal.addEventListener('click', function(event) {
    const trigger = event.target.closest("[data-action]");
    if (trigger) {
      const action = trigger.dataset.action;
      
      // Manejar acciones específicas del modal
      if (action === "close-modal") {
        modal.remove();
        return;
      }
      
      // Para otras acciones, remover modal primero
      if (action !== "view-order") {
        modal.remove();
      }
      
      // Ejecutar la acción correspondiente
      handleClick(event);
    }
  });
  
  // Manejar cambios en inputs dentro del modal
  modal.addEventListener('input', function(event) {
    if (event.target.classList.contains("input-entregado")) {
      handleDeliveredQuantityChange(event.target);
    }
  });
  
  modal.style.display = "flex";
}

function handleDeliveredQuantityChange(input) {
  const orderId = input.dataset.orderId;
  const productId = input.dataset.productId;
  const newQuantity = normalizeNumber(input.value, 0);
  
  const order = getKitchenOrderById(orderId);
  if (!order || order.sentToBranch) return;
  
  const item = order.items.find(i => i.productId === productId);
  if (!item) return;
  
  const oldQuantity = item.delivered;
  item.delivered = roundStock(Math.max(0, newQuantity));
  item.pending = roundStock(Math.max(0, item.requested - item.delivered));
  
  // Si la cantidad cambió, generar notificación
  if (oldQuantity !== item.delivered) {
    generateDeliveryNotification(order, item, 'cantidad_modificada');
  }
  
  saveState();
  render();
}

function markProductAsUnavailable(orderId, productId, productName) {
  const order = getKitchenOrderById(orderId);
  if (!order || order.sentToBranch) {
    setFlash("kitchen-orders", "error", "No se puede modificar un pedido ya enviado a sucursal.");
    return;
  }
  
  const item = order.items.find(i => i.productId === productId);
  if (!item) return;
  
  item.unavailable = !item.unavailable;
  item.delivered = item.unavailable ? 0 : item.requested;
  item.pending = item.unavailable ? item.requested : 0;
  
  if (item.unavailable) {
    generateDeliveryNotification(order, item, 'producto_no_disponible');
    setFlash("kitchen-orders", "warning", `${productName} marcado como no disponible.`);
  } else {
    setFlash("kitchen-orders", "success", `${productName} disponible nuevamente.`);
  }
  
  saveState();
  render();
}

function generateDeliveryNotification(order, item, incidentType) {
  const incident = {
    orderId: order.id,
    orderNumber: order.number,
    branchName: order.branchName,
    brandName: order.brandName,
    productId: item.productId,
    productName: item.productName,
    incidentType: incidentType,
    requestedQuantity: item.requested,
    deliveredQuantity: item.delivered,
    timestamp: new Date().toISOString(),
    acknowledged: false
  };
  
  // Añadir a las notificaciones internas
  if (!state.deliveryIncidents) {
    state.deliveryIncidents = [];
  }
  state.deliveryIncidents.push(incident);
  
  saveState();
}

function getOrderIncidents(order) {
  if (!state.deliveryIncidents) return [];
  
  return state.deliveryIncidents
    .filter(incident => incident.orderId === order.id)
    .map(incident => {
      if (incident.incidentType === 'cantidad_modificada') {
        return `${incident.productName}: Cantidad modificada de ${incident.requestedQuantity} a ${incident.deliveredQuantity}`;
      } else if (incident.incidentType === 'producto_no_disponible') {
        return `${incident.productName}: Producto no disponible`;
      }
      return '';
    });
}

function sendOrderToBranch(orderId) {
  const order = getKitchenOrderById(orderId);
  
  if (!order) {
    setFlash("kitchen-orders", "error", "No se encontró el pedido.");
    return;
  }
  
  if (!order.forwardedToDispatch) {
    setFlash("kitchen-orders", "error", "El pedido debe ser enviado al encargado primero.");
    return;
  }
  
  // Actualizar estado del pedido
  order.sentToBranch = true;
  order.sentToBranchAt = new Date().toISOString();
  order.sentToBranchById = session.activeCollaboratorId;
  order.sentToBranchByName = getAuthenticatedCollaborator()?.name || "Sistema";
  
  // Descontar del inventario las cantidades entregadas
  order.items.forEach(item => {
    if (item.delivered > 0) {
      const product = getProductById(item.productId);
      if (product) {
        product.stock = roundStock(Math.max(0, product.stock - item.delivered));
      }
    }
  });
  
  // Generar notificación para líderes de turno
  generateBranchNotification(order);
  
  setFlash("kitchen-orders", "success", `Pedido ${order.number} enviado a sucursal.`);
  saveState();
  render();
}

function generateBranchNotification(order) {
  const notification = {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'branch_delivery',
    orderId: order.id,
    orderNumber: order.number,
    branchName: order.branchName,
    brandName: order.brandName,
    date: order.date,
    sentAt: order.sentToBranchAt,
    sentBy: order.sentToBranchByName,
    acknowledged: false,
    timestamp: new Date().toISOString()
  };
  
  if (!state.branchNotifications) {
    state.branchNotifications = [];
  }
  state.branchNotifications.push(notification);
  
  saveState();
}

function getDeliveryIncidents() {
  if (!state.deliveryIncidents) return [];
  
  return state.deliveryIncidents
    .filter(incident => !incident.acknowledged)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function renderBranchNotificationsSection() {
  const branchNotifications = getBranchNotifications();
  
  if (branchNotifications.length === 0) {
    return `
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Notificaciones para Líderes de Turno</h2>
            <p>Aquí aparecen los pedidos enviados a sucursales que requieren seguimiento.</p>
          </div>
        </div>
        ${renderEmptyState(
          "No hay pedidos enviados a sucursales",
          "Los pedidos enviados a sucursales aparecerán aquí para seguimiento de líderes de turno."
        )}
      </section>
    `;
  }
  
  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>Notificaciones para Líderes de Turno</h2>
          <p>Pedidos enviados a sucursales que requieren seguimiento.</p>
        </div>
      </div>
      <div class="notification-list">
        ${branchNotifications.map(notification => `
          <article class="notification-card">
            <div class="notification-head">
              <strong>📦 Pedido ${escapeHtml(notification.orderNumber)} Enviado</strong>
              <span class="status-chip status-active">Enviado a sucursal</span>
            </div>
            <div class="notification-body">
              <p><strong>Sucursal destino:</strong> ${escapeHtml(notification.branchName)} / ${escapeHtml(notification.brandName)}</p>
              <div class="notification-meta">
                <span class="pill">Fecha pedido: ${escapeHtml(formatDate(notification.date))}</span>
                <span class="pill">Enviado: ${escapeHtml(formatDate(notification.sentAt))}</span>
                <span class="pill">Enviado por: ${escapeHtml(notification.sentBy)}</span>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function getBranchNotifications() {
  if (!state.branchNotifications) return [];
  
  return state.branchNotifications
    .filter(notification => !notification.acknowledged)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function canEditBranchStoreStock(branchId) {
  if (!session.authenticated) {
    return false;
  }

  if (isMasterUserSession()) {
    return Boolean(getBranchLocationById(branchId));
  }

  const collaborator = getAuthenticatedCollaborator();
  const branch = getBranchLocationById(branchId);

  if (!collaborator || !branch) {
    return false;
  }

  return (
    normalizeCollaboratorRole(collaborator.area) === "lider_de_turno" &&
    (normalizeCollaboratorBranch(collaborator.branch) === ALL_BRANCHES_OPTION ||
      normalizeCollaboratorBranch(collaborator.branch) === normalizeCollaboratorBranch(branch.name))
  );
}

function getOperatorAccessMessage(targetModule) {
  if (targetModule === "cold-room") {
    return "Ingresa con la contrasena del Encargado o con la clave administrativa para abrir Cuarto Frio.";
  }

  if (targetModule === "orders") {
    return "Solo los usuarios con rol Administrador pueden entrar al modulo Pedidos.";
  }

  if (targetModule === "branches") {
    return "Este perfil solo tiene acceso operativo al modulo Cocina.";
  }

  if (targetModule === "kitchen") {
    return "Inicia sesion con un usuario activo para acceder al modulo Cocina.";
  }

  return "Los permisos se asignan automaticamente desde el acceso actual.";
}

function getDispatchAccessMessage() {
  if (!canAccessColdRoomModule()) {
    return "Abre Cuarto Frio con una contrasena autorizada para habilitar este formulario.";
  }

  if (isMasterUserSession()) {
    return `Despacho autorizado para ${CREDENTIALS.username} (Administrador maestro).`;
  }

  if (getSessionRole() === "administrador") {
    return "La cuenta administrativa puede gestionar Cuarto Frio, pero solo un Encargado autenticado puede despachar mercancia.";
  }

  if (isBootstrapMode() || !getActiveStoreManager()) {
    return "Registra un Encargado activo en Equipo para habilitar el despacho de mercancia.";
  }

  const operator = getSessionOperator();
  const operatorLabel = operator
    ? `${operator.name} (${formatCollaboratorRole(operator.area)})`
    : "Sin Encargado activo";

  return `Despacho autorizado para ${operatorLabel}.`;
}

function renderEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function setFlash(scope, type, message) {
  if (ui.flashTimerId) {
    window.clearTimeout(ui.flashTimerId);
    ui.flashTimerId = null;
  }

  ui.flashToken += 1;
  const token = ui.flashToken;
  const durationMs = 10000;
  ui.flash = { scope, type, message, token, startedAt: Date.now(), durationMs };
  ui.flashTimerId = window.setTimeout(() => {
    if (!ui.flash || ui.flash.token !== token) {
      return;
    }

    ui.flash = null;
    ui.flashTimerId = null;
    render();
  }, durationMs);
}

function resetProductWorkflowState() {
  ui.productMatchId = "";
  ui.pendingAssignmentProductId = "";
  closeProductProductionPrompt();
}

function closeProductProductionPrompt() {
  ui.productProductionPrompt = false;
  ui.productProductionProductId = "";
}

function normalizeProductLookupName(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function getProductByName(productName, excludeProductId = "") {
  const lookupName = normalizeProductLookupName(productName);
  if (!lookupName) {
    return null;
  }

  return (
    state.products.find(
      (product) =>
        product.id !== excludeProductId &&
        normalizeProductLookupName(product.name) === lookupName,
    ) || null
  );
}

function updateProductFormMatchHint(form, message = "") {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const hint = form.querySelector("[data-product-match-hint]");
  if (!(hint instanceof HTMLElement)) {
    return;
  }

  hint.textContent = message;
}

function syncProductFormFromName(form, rawName) {
  if (!(form instanceof HTMLFormElement) || ui.editingProductId) {
    return;
  }

  const previousMatchId = ui.productMatchId;
  const matchedProduct = getProductByName(rawName);
  const unitField = form.querySelector("#product-unit");
  const stockCurrentField = form.querySelector("#product-stock-current");
  const stockIdealField = form.querySelector("#product-stock-ideal");

  ui.productMatchId = matchedProduct ? matchedProduct.id : "";

  if (matchedProduct) {
    if (unitField instanceof HTMLInputElement) {
      unitField.value = PRODUCT_DEFAULT_UNIT;
    }
    if (stockCurrentField instanceof HTMLInputElement) {
      stockCurrentField.value = String(matchedProduct.stockCurrent ?? 0);
    }
    if (stockIdealField instanceof HTMLInputElement) {
      stockIdealField.value = String(matchedProduct.stockIdeal ?? 0);
    }

    updateProductFormMatchHint(
      form,
      `Producto encontrado en almacen. Puedes actualizar sus datos sin volver a escribir todo.`,
    );
    return;
  }

  if (previousMatchId) {
    if (unitField instanceof HTMLInputElement) {
      unitField.value = PRODUCT_DEFAULT_UNIT;
    }
    if (stockCurrentField instanceof HTMLInputElement) {
      stockCurrentField.value = "0";
    }
    if (stockIdealField instanceof HTMLInputElement) {
      stockIdealField.value = "0";
    }
  }

  updateProductFormMatchHint(form, "");
}

function confirmProductProduction() {
  const product = getProductById(ui.productProductionProductId);

  closeProductProductionPrompt();

  if (!product) {
    render();
    return;
  }

  ui.currentModule = "cold-room";
  ui.coldRoomSection = "equipo";
  ui.pendingAssignmentProductId = product.id;
  setFlash(
    "assignment",
    "info",
    `Selecciona un colaborador para enviar ${product.name} a produccion usando su stock ideal.`,
  );
  render();
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId) || null;
}

function getCollaboratorById(collaboratorId) {
  return state.collaborators.find((collaborator) => collaborator.id === collaboratorId) || null;
}

function getSortedProducts() {
  return [...state.products].sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function getSortedCollaborators() {
  return [...state.collaborators].sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function getAssignmentsForCollaborator(collaboratorId) {
  return getEnrichedAssignments().filter((assignment) => assignment.collaboratorId === collaboratorId);
}

function getAssignmentsForProduct(productId) {
  return getEnrichedAssignments().filter((assignment) => assignment.productId === productId);
}

function getEnrichedAssignments() {
  return state.assignments
    .map((assignment) => {
      const collaborator = getCollaboratorById(assignment.collaboratorId);
      const product = getProductById(assignment.productId);
      if (!collaborator || !product) {
        return null;
      }

      return {
        ...assignment,
        targetQuantity: product.stockIdeal,
        collaboratorName: collaborator.name,
        collaboratorStatus: collaborator.status,
        productName: product.name,
        unit: product.unit,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.collaboratorName.localeCompare(right.collaboratorName, "es"));
}

function getActiveAssignedCollaboratorNames(productId) {
  return getAssignmentsForProduct(productId)
    .filter((assignment) => assignment.collaboratorStatus === "active")
    .map((assignment) => assignment.collaboratorName);
}

function getProductsWithAssignmentsCount() {
  const linkedIds = new Set(state.assignments.map((assignment) => assignment.productId));
  return linkedIds.size;
}

function isProductLowStock(product) {
  return Boolean(product) && product.status === "active" && product.stockCurrent < product.stockIdeal;
}

function getProductShortage(product) {
  if (!product) {
    return 0;
  }

  return roundStock(Math.max(product.stockIdeal - product.stockCurrent, 0));
}

function buildLowStockNotificationMessage(product) {
  const shortage = getProductShortage(product);
  return `El stock del producto ${product.name} está bajo. Faltan ${formatNumber(shortage)} ${product.unit} para alcanzar el stock ideal. Reponer lo más pronto posible.`;
}

function isNotificationAlertActive(notification) {
  if (!notification || notification.status === "completada") {
    return false;
  }

  const sourceType = normalizeNotificationSourceType(notification.sourceType, notification);

  if (sourceType === "branch_stock") {
    const product = getProductById(notification.productId);
    const record = getBranchNeedRecord(notification.branchId, notification.brandName);
    return Boolean(product) && getBranchProductRequestShortage(record, product) > 0;
  }

  const product = getProductById(notification.productId);
  return isProductLowStock(product);
}

function reconcileNotificationsWithInventory() {
  let changed = false;

  state.branchNeeds = state.branchNeeds.map((branchNeed) => {
    const nextProductIds = branchNeed.productIds.filter((productId) =>
      isBranchProductRequestable(branchNeed, getProductById(productId)),
    );

    if (nextProductIds.length === branchNeed.productIds.length) {
      return branchNeed;
    }

    changed = true;
    return {
      ...branchNeed,
      productIds: nextProductIds,
      updatedAt: new Date().toISOString(),
    };
  });

  state.products.forEach((product) => {
    const relatedNotifications = state.notifications
      .filter(
        (notification) =>
          notification.productId === product.id &&
          normalizeNotificationSourceType(notification.sourceType, notification) === "cold_room",
      )
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    if (isProductLowStock(product)) {
      const activeNotification = relatedNotifications.find(
        (notification) => notification.status !== "completada",
      );

      if (activeNotification) {
        const nextNames = getActiveAssignedCollaboratorNames(product.id);
        const nextMessage = buildLowStockNotificationMessage(product);
        const nextQuantity = getProductShortage(product);

        if (
          activeNotification.productName !== product.name ||
          activeNotification.unit !== product.unit ||
          activeNotification.quantity !== nextQuantity ||
          activeNotification.message !== nextMessage ||
          activeNotification.destination !== "Reposición interna" ||
          activeNotification.collaboratorNames.join("|") !== nextNames.join("|") ||
          activeNotification.taskRequired !== true
        ) {
          activeNotification.productName = product.name;
          activeNotification.unit = product.unit;
          activeNotification.quantity = nextQuantity;
          activeNotification.message = nextMessage;
          activeNotification.destination = "Reposición interna";
          activeNotification.collaboratorNames = nextNames;
          activeNotification.taskRequired = true;
          changed = true;
        }
      } else {
        state.notifications.unshift({
          id: createId("notification"),
          productId: product.id,
          productName: product.name,
          quantity: getProductShortage(product),
          unit: product.unit,
          message: buildLowStockNotificationMessage(product),
          date: today(),
          createdAt: new Date().toISOString(),
          destination: "Reposición interna",
          collaboratorNames: getActiveAssignedCollaboratorNames(product.id),
          status: "pendiente",
          taskRequired: true,
          completedAt: "",
          sourceHistoryId: "",
          sourceOrderId: "",
          sourceType: "cold_room",
          branchId: "",
          brandName: "",
        });
        changed = true;
      }
    } else {
      relatedNotifications.forEach((notification) => {
        if (notification.status !== "completada") {
          notification.status = "completada";
          notification.completedAt = notification.completedAt || new Date().toISOString();
          changed = true;
        }
      });
    }
  });

  state.branchNeeds.forEach((branchNeed) => {
    const branch = getBranchLocationById(branchNeed.branchId);
    const normalizedBrandName = normalizeBranchBrand(branchNeed.brandName);

    if (!branch || !normalizedBrandName) {
      return;
    }

    Object.keys(branchNeed.stockByProductId || {}).forEach((productId) => {
      if (syncBranchStockNotification(branchNeed.branchId, normalizedBrandName, productId)) {
        changed = true;
      }
    });
  });

  state.notifications.forEach((notification) => {
    if (
      normalizeNotificationSourceType(notification.sourceType, notification) !== "branch_stock" ||
      notification.status === "completada"
    ) {
      return;
    }

    const product = getProductById(notification.productId);
    const record = getBranchNeedRecord(notification.branchId, notification.brandName);
    if (!product || getBranchProductRequestShortage(record, product) <= 0) {
      notification.status = "completada";
      notification.completedAt = notification.completedAt || new Date().toISOString();
      changed = true;
    }
  });

  return changed;
}

function getLowStockProducts() {
  return state.products.filter(
    (product) => isProductLowStock(product),
  );
}

function getPendingNotifications() {
  const seenNotifications = new Set();

  return [...state.notifications]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .filter((notification) => {
      if (!isNotificationAlertActive(notification)) {
        return false;
      }

      const notificationKey = getNotificationIdentityKey(notification);

      if (seenNotifications.has(notificationKey)) {
        return false;
      }

      seenNotifications.add(notificationKey);
      return true;
    });
}

function getBranchLocationById(branchId) {
  return BRANCH_LOCATIONS.find((branch) => branch.id === branchId) || null;
}

function normalizeBranchBrand(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const matchedBrand = BRANCH_BRANDS.find(
    (brandName) =>
      brandName
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") === normalizedValue,
  );

  return matchedBrand || "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeBranchStockMap(rawValue, validProductIds = new Set()) {
  if (!rawValue || typeof rawValue !== "object") {
    return {};
  }

  return Object.entries(rawValue).reduce((stockMap, [productId, stockValue]) => {
    const normalizedProductId = String(productId || "");
    if (!normalizedProductId || (validProductIds.size > 0 && !validProductIds.has(normalizedProductId))) {
      return stockMap;
    }

    const normalizedStock = normalizeNumber(stockValue, Number.NaN);
    if (!Number.isFinite(normalizedStock) || normalizedStock < 0) {
      return stockMap;
    }

    stockMap[normalizedProductId] = roundStock(normalizedStock);
    return stockMap;
  }, {});
}

function formatBranchDestination(branch, brandName) {
  return `${branch.name} / ${brandName}`;
}

function createBranchNeedKey(branchId, brandName) {
  return [String(branchId || "").trim(), normalizeBranchBrand(brandName)].join("|");
}

function getBranchStorageRecord(branchId) {
  return (
    state.branchStorage?.find((branchStorage) => branchStorage.branchId === String(branchId || "")) || {
      branchId: String(branchId || ""),
      stockByProductId: {},
      updatedAt: "",
    }
  );
}

function getBranchConsumptionRecord(branchId) {
  return (
    state.branchConsumption?.find(
      (branchConsumption) => branchConsumption.branchId === String(branchId || ""),
    ) || {
      branchId: String(branchId || ""),
      consumptionByProductId: {},
      updatedAt: "",
    }
  );
}

function getBranchDailyQuantityRecord(branchId) {
  return (
    state.branchDailyQuantities?.find(
      (branchDailyQuantity) => branchDailyQuantity.branchId === String(branchId || ""),
    ) || {
      branchId: String(branchId || ""),
      dailyQuantityByProductId: {},
      updatedAt: "",
    }
  );
}

function getBranchNeedRecordsForBranch(branchId) {
  return state.branchNeeds.filter((branchNeed) => branchNeed.branchId === branchId);
}

function getBranchCatalogRecord(branchId, brandName) {
  const normalizedBrandName = normalizeBranchBrand(brandName);
  return (
    state.branchCatalogs?.find(
      (branchCatalog) =>
        branchCatalog.branchId === String(branchId || "") &&
        normalizeBranchBrand(branchCatalog.brandName) === normalizedBrandName,
    ) || {
      branchId: String(branchId || ""),
      brandName: normalizedBrandName,
      productIds: [],
      updatedAt: "",
    }
  );
}

function getBranchBrandVisibleProducts(branchId, brandName, products = getSortedProducts()) {
  const visibleProductIds = new Set(getBranchCatalogRecord(branchId, brandName).productIds || []);
  return products.filter((product) => visibleProductIds.has(product.id));
}

function getBranchAssignedBrands(branchId, productId) {
  return BRANCH_BRANDS.filter((brandName) =>
    getBranchCatalogRecord(branchId, brandName).productIds.includes(String(productId || "")),
  );
}

function getOrderPanelsWithRequests() {
  return state.branchNeeds
    .filter((branchNeed) => branchNeed.productIds.length > 0)
    .map((branchNeed) => {
      const branch = getBranchLocationById(branchNeed.branchId);
      const products = branchNeed.productIds
        .map((productId) => {
          const product = getProductById(productId);
          if (!product) {
            return null;
          }

          if (!isBranchProductRequestable(branchNeed, product)) {
            return null;
          }

          return {
            ...product,
            storeStock: getBranchProductStoreStock(branchNeed, productId),
            dailyQuantity: getBranchProductDailyQuantity(branchNeed.branchId, productId),
            orderQuantity: getBranchProductOrderQuantity(branchNeed, product),
          };
        })
        .filter(Boolean);

      if (!branch || products.length === 0) {
        return null;
      }

      return {
        branchId: branch.id,
        branchName: branch.name,
        brandName: branchNeed.brandName,
        products,
        updatedAtLabel: branchNeed.updatedAt
          ? `Actualizado ${formatDateTime(branchNeed.updatedAt)}`
          : "Sin fecha",
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.branchName !== right.branchName) {
        return left.branchName.localeCompare(right.branchName, "es");
      }

      return left.brandName.localeCompare(right.brandName, "es");
    });
}

function getBranchNeedRecord(branchId, brandName = "") {
  if (brandName) {
    return (
      state.branchNeeds.find(
        (branchNeed) =>
          branchNeed.branchId === branchId &&
          normalizeBranchBrand(branchNeed.brandName) === normalizeBranchBrand(brandName),
      ) || {
        branchId,
        brandName: normalizeBranchBrand(brandName),
        productIds: [],
        stockByProductId: {},
        updatedAt: "",
      }
    );
  }

  const records = getBranchNeedRecordsForBranch(branchId);
  const productIds = [...new Set(records.flatMap((record) => record.productIds))];
  const stockByProductId = records.reduce((stockMap, record) => {
    Object.entries(record.stockByProductId || {}).forEach(([productId, stockValue]) => {
      stockMap[productId] = stockValue;
    });
    return stockMap;
  }, {});
  const updatedAt = records
    .map((record) => record.updatedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || "";

  return {
    branchId,
    brandName: "",
    productIds,
    stockByProductId,
    updatedAt,
  };
}

function hasBranchStoreStock(record, productId) {
  if (!record || !productId) {
    return false;
  }

  const branchStorageRecord = getBranchStorageRecord(record.branchId);
  if (Object.prototype.hasOwnProperty.call(branchStorageRecord.stockByProductId || {}, productId)) {
    return true;
  }

  return Object.prototype.hasOwnProperty.call(record.stockByProductId || {}, productId);
}

function getBranchProductStoreStock(record, productId) {
  if (!record || !productId) {
    return null;
  }

  const branchStorageRecord = getBranchStorageRecord(record.branchId);
  if (Object.prototype.hasOwnProperty.call(branchStorageRecord.stockByProductId || {}, productId)) {
    return normalizeNumber(branchStorageRecord.stockByProductId[productId], 0);
  }

  if (!Object.prototype.hasOwnProperty.call(record.stockByProductId || {}, productId)) {
    return null;
  }

  return normalizeNumber(record.stockByProductId[productId], 0);
}

function getBranchStorageProductStatus(record, product) {
  const storeStock = getBranchProductStoreStock(record, product?.id);
  if (!product || storeStock === null) {
    return {
      label: "Sin stock registrado",
      className: "status-inactive",
      storeStock,
    };
  }

  if (storeStock <= 0) {
    return {
      label: "Sin stock",
      className: "status-inactive",
      storeStock,
    };
  }

  if (storeStock >= product.stockIdeal) {
    return {
      label: "Abastecido",
      className: "status-active",
      storeStock,
    };
  }

  return {
    label: "Bajo",
    className: "status-en_progreso",
    storeStock,
  };
}

function getBranchStorageCardStats(branchId, products) {
  const record = getBranchStorageRecord(branchId);

  return products.reduce(
    (summary, product) => {
      const status = getBranchStorageProductStatus(record, product);

      summary.total += 1;
      if (status.storeStock !== null) {
        summary.withStock += 1;
      }
      if (status.label !== "Abastecido") {
        summary.pending += 1;
      }

      return summary;
    },
    {
      total: 0,
      withStock: 0,
      pending: 0,
    },
  );
}

function getBranchProductConsumption(branchId, productId) {
  const record = getBranchConsumptionRecord(branchId);
  if (!Object.prototype.hasOwnProperty.call(record.consumptionByProductId || {}, productId)) {
    return null;
  }

  return normalizeNumber(record.consumptionByProductId[productId], 0);
}

function getBranchProductDailyQuantity(branchId, productId) {
  const record = getBranchDailyQuantityRecord(branchId);
  if (!Object.prototype.hasOwnProperty.call(record.dailyQuantityByProductId || {}, productId)) {
    return null;
  }

  return normalizeNumber(record.dailyQuantityByProductId[productId], 0);
}

function getBranchProductOrderQuantity(record, product) {
  if (!record || !product) {
    return 0;
  }

  return getBranchProductRequestShortage(record, product);
}

function getBranchProductRequestBase(branchId, product) {
  if (!product) {
    return 0;
  }

  const configuredConsumption = getBranchProductConsumption(branchId, product.id);
  if (configuredConsumption !== null) {
    return roundStock(configuredConsumption);
  }

  return roundStock(product.stockIdeal);
}

function getBranchProductRequestBaseLabel(branchId, product) {
  if (!product) {
    return "la reposicion configurada";
  }

  if (getBranchProductConsumption(branchId, product.id) !== null) {
    return "el consumo de tienda";
  }

  return "el stock ideal de tienda";
}

function setBranchStoreStockValue(branchId, productId, rawStockValue, updatedAt = new Date().toISOString()) {
  const product = getProductById(productId);
  const hasValue = typeof rawStockValue === "number" && Number.isFinite(rawStockValue) && rawStockValue >= 0;
  const nextStockValue = hasValue ? roundStock(rawStockValue) : null;

  state.branchStorage = (state.branchStorage || defaultBranchStorage()).map((branchStorage) => {
    if (branchStorage.branchId !== branchId) {
      return branchStorage;
    }

    const nextStockMap = { ...(branchStorage.stockByProductId || {}) };
    if (nextStockValue === null) {
      delete nextStockMap[productId];
    } else {
      nextStockMap[productId] = nextStockValue;
    }

    return {
      ...branchStorage,
      stockByProductId: nextStockMap,
      updatedAt,
    };
  });

  state.branchNeeds = state.branchNeeds.map((branchNeed) => {
    if (branchNeed.branchId !== branchId) {
      return branchNeed;
    }

    const nextStockMap = { ...(branchNeed.stockByProductId || {}) };
    if (nextStockValue === null) {
      delete nextStockMap[productId];
    } else {
      nextStockMap[productId] = nextStockValue;
    }

    const nextProductIds =
      nextStockValue !== null &&
      product &&
      nextStockValue >= getBranchProductRequestBase(branchId, product)
        ? branchNeed.productIds.filter((currentProductId) => currentProductId !== productId)
        : branchNeed.productIds;

    return {
      ...branchNeed,
      stockByProductId: nextStockMap,
      productIds: nextProductIds,
      updatedAt,
    };
  });
}

function setBranchConsumptionValue(branchId, productId, rawConsumptionValue, updatedAt = new Date().toISOString()) {
  const hasValue =
    typeof rawConsumptionValue === "number" &&
    Number.isFinite(rawConsumptionValue) &&
    rawConsumptionValue >= 0;
  const nextConsumptionValue = hasValue ? roundStock(rawConsumptionValue) : null;

  state.branchConsumption = (state.branchConsumption || defaultBranchConsumption()).map(
    (branchConsumption) => {
      if (branchConsumption.branchId !== branchId) {
        return branchConsumption;
      }

      const nextConsumptionMap = { ...(branchConsumption.consumptionByProductId || {}) };
      if (nextConsumptionValue === null) {
        delete nextConsumptionMap[productId];
      } else {
        nextConsumptionMap[productId] = nextConsumptionValue;
      }

      return {
        ...branchConsumption,
        consumptionByProductId: nextConsumptionMap,
        updatedAt,
      };
    },
  );
}

function setBranchDailyQuantityValue(
  branchId,
  productId,
  rawDailyQuantityValue,
  updatedAt = new Date().toISOString(),
) {
  const hasValue =
    typeof rawDailyQuantityValue === "number" &&
    Number.isFinite(rawDailyQuantityValue) &&
    rawDailyQuantityValue >= 0;
  const nextDailyQuantityValue = hasValue ? roundStock(rawDailyQuantityValue) : null;

  state.branchDailyQuantities = (state.branchDailyQuantities || defaultBranchDailyQuantities()).map(
    (branchDailyQuantity) => {
      if (branchDailyQuantity.branchId !== branchId) {
        return branchDailyQuantity;
      }

      const nextDailyQuantityMap = { ...(branchDailyQuantity.dailyQuantityByProductId || {}) };
      if (nextDailyQuantityValue === null) {
        delete nextDailyQuantityMap[productId];
      } else {
        nextDailyQuantityMap[productId] = nextDailyQuantityValue;
      }

      return {
        ...branchDailyQuantity,
        dailyQuantityByProductId: nextDailyQuantityMap,
        updatedAt,
      };
    },
  );
}

function getBranchProductShortage(record, product) {
  const storeStock = getBranchProductStoreStock(record, product?.id);
  if (!product || storeStock === null) {
    return 0;
  }

  return roundStock(Math.max(product.stockIdeal - storeStock, 0));
}

function getBranchProductRequestShortage(record, product) {
  if (!record || !product) {
    return 0;
  }

  const requestBase = getBranchProductRequestBase(record.branchId, product);
  if (requestBase <= 0) {
    return 0;
  }

  const storeStock = getBranchProductStoreStock(record, product.id);
  if (storeStock === null) {
    return roundStock(requestBase);
  }

  return roundStock(Math.max(requestBase - storeStock, 0));
}

function isBranchProductRequestable(record, product) {
  if (!product) {
    return false;
  }

  return getBranchProductOrderQuantity(record, product) > 0;
}

function getRequestableBranchProductIds(record) {
  return record.productIds.filter((productId) => isBranchProductRequestable(record, getProductById(productId)));
}

function countRequestableBranchProducts(record) {
  return getRequestableBranchProductIds(record).length;
}

function buildBranchStockNotificationMessage(branch, brandName, product, storeStock) {
  const shortage = getBranchProductRequestShortage(getBranchNeedRecord(branch.id, brandName), product);
  const requestBaseLabel = getBranchProductRequestBaseLabel(branch.id, product);
  return `La marca ${brandName} de ${branch.name} tiene ${formatNumber(storeStock)} ${product.unit} de ${product.name}. Faltan ${formatNumber(shortage)} ${product.unit} para cubrir ${requestBaseLabel}. Reponer lo mas pronto posible.`;
}

function syncBranchStockNotification(
  branchId,
  brandName,
  productId,
  { allowCreate = false, sourceOrderId = "" } = {},
) {
  const branch = getBranchLocationById(branchId);
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const product = getProductById(productId);
  const record = getBranchNeedRecord(branchId, normalizedBrandName);
  const currentStoreStock = getBranchProductStoreStock(record, productId);
  const storeStock = currentStoreStock === null ? 0 : normalizeNumber(currentStoreStock, 0);
  const shortage = product ? getBranchProductRequestShortage(record, product) : 0;
  const hasPendingKitchenOrder = state.kitchenOrders.some(
    (order) =>
      order.status === "pendiente" &&
      order.forwardedToDispatch === true &&
      order.branchId === branchId &&
      normalizeBranchBrand(order.brandName) === normalizedBrandName &&
      Array.isArray(order.items) &&
      order.items.some(
        (item) =>
          item.productId === productId &&
          roundStock(Math.max(normalizeNumber(item.pending, item.requested), 0)) > 0,
      ),
  );
  const relatedNotifications = state.notifications
    .filter(
      (notification) =>
        normalizeNotificationSourceType(notification.sourceType, notification) === "branch_stock" &&
        notification.productId === productId &&
        notification.branchId === branchId &&
        normalizeBranchBrand(notification.brandName) === normalizedBrandName,
    )
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  let changed = false;

  if (!product || !branch || !normalizedBrandName) {
    relatedNotifications.forEach((notification) => {
      if (notification.status !== "completada") {
        notification.status = "completada";
        notification.completedAt = notification.completedAt || new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  if (!allowCreate && !hasPendingKitchenOrder) {
    relatedNotifications.forEach((notification) => {
      if (notification.status !== "completada") {
        notification.status = "completada";
        notification.completedAt = notification.completedAt || new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  if (shortage > 0) {
    const activeNotification = relatedNotifications.find(
      (notification) => notification.status !== "completada",
    );
    const nextNames = getActiveAssignedCollaboratorNames(product.id);
    const nextMessage = buildBranchStockNotificationMessage(branch, normalizedBrandName, product, storeStock);
    const nextDestination = formatBranchDestination(branch, normalizedBrandName);

    if (activeNotification) {
      if (
        activeNotification.productName !== product.name ||
        activeNotification.unit !== product.unit ||
        activeNotification.quantity !== shortage ||
        activeNotification.message !== nextMessage ||
        activeNotification.destination !== nextDestination ||
        activeNotification.collaboratorNames.join("|") !== nextNames.join("|") ||
        activeNotification.taskRequired !== true ||
        (sourceOrderId && activeNotification.sourceOrderId !== sourceOrderId)
      ) {
        activeNotification.productName = product.name;
        activeNotification.unit = product.unit;
        activeNotification.quantity = shortage;
        activeNotification.message = nextMessage;
        activeNotification.destination = nextDestination;
        activeNotification.collaboratorNames = nextNames;
        activeNotification.taskRequired = true;
        if (sourceOrderId) {
          activeNotification.sourceOrderId = sourceOrderId;
        }
        changed = true;
      }
    } else if (allowCreate) {
      state.notifications.unshift({
        id: createId("notification"),
        productId: product.id,
        productName: product.name,
        quantity: shortage,
        unit: product.unit,
        message: nextMessage,
        date: today(),
        createdAt: new Date().toISOString(),
        destination: nextDestination,
        collaboratorNames: nextNames,
        status: "pendiente",
        taskRequired: true,
        completedAt: "",
        sourceHistoryId: "",
        sourceOrderId,
        sourceType: "branch_stock",
        branchId: branch.id,
        brandName: normalizedBrandName,
      });
      changed = true;
    }
  } else {
    relatedNotifications.forEach((notification) => {
      if (notification.status !== "completada") {
        notification.status = "completada";
        notification.completedAt = notification.completedAt || new Date().toISOString();
        changed = true;
      }
    });
  }

  return changed;
}

function formatBranchProductMeta(product) {
  return `Cuarto Frio ${formatNumber(product.stockCurrent)} ${product.unit} · Ideal tienda ${formatNumber(product.stockIdeal)} ${product.unit}`;
}

function getBranchesWithRequestedProducts() {
  return BRANCH_LOCATIONS.filter((branch) => getBranchRequestedProductsCount(branch.id) > 0);
}

function getBranchRequestedProductsCount(branchId) {
  return getBranchNeedRecordsForBranch(branchId).reduce(
    (total, record) => total + countRequestableBranchProducts(record),
    0,
  );
}

function getBranchActiveBrandCount(branchId) {
  return getBranchNeedRecordsForBranch(branchId).filter(
    (branchNeed) => countRequestableBranchProducts(branchNeed) > 0,
  ).length;
}

function getTotalBranchRequestedProducts() {
  return state.branchNeeds.reduce(
    (total, branchNeed) => total + countRequestableBranchProducts(branchNeed),
    0,
  );
}

function toggleBranchProductNeed(branchId, brandName, productId, checked) {
  const branchExists = Boolean(getBranchLocationById(branchId));
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const product = getProductById(productId);
  const branchNeedRecord = getBranchNeedRecord(branchId, normalizedBrandName);

  if (!branchExists || !normalizedBrandName || !product) {
    return;
  }

  if (checked && !isBranchProductRequestable(branchNeedRecord, product)) {
    setFlash(
      "branches",
      "info",
      "Ese producto ya esta abastecido y tampoco tiene cantidad diaria registrada, por lo que no se genera un pedido.",
    );
    render();
    return;
  }

  state.branchNeeds = state.branchNeeds.map((branchNeed) => {
    if (
      branchNeed.branchId !== branchId ||
      normalizeBranchBrand(branchNeed.brandName) !== normalizedBrandName
    ) {
      return branchNeed;
    }

    const productIds = new Set(branchNeed.productIds);
    if (checked) {
      productIds.add(productId);
    } else {
      productIds.delete(productId);
    }

    return {
      ...branchNeed,
      brandName: normalizedBrandName,
      productIds: [...productIds],
      updatedAt: new Date().toISOString(),
    };
  });

  ui.pendingAssignmentProductId = "";
  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function getBranchOrderSendQuantity(branchNeed, product) {
  if (!branchNeed || !product) {
    return 0;
  }

  return getBranchProductOrderQuantity(branchNeed, product);
}

function sendBranchOrderToKitchenOrders(branchId, brandName, productId) {
  const branch = getBranchLocationById(branchId);
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const product = getProductById(productId);
  const requester = getAuthenticatedIdentity() || {
    id: "",
    name: CREDENTIALS.username,
    role: "administrador",
    branch: "",
  };
  const branchNeed = getBranchNeedRecord(branchId, normalizedBrandName);
  const requestedQuantity = getBranchOrderSendQuantity(branchNeed, product);

  if (!branch || !normalizedBrandName || !product) {
    setFlash("orders", "error", "No se pudo enviar el producto al panel de pedidos.");
    render();
    return;
  }

  if (requestedQuantity <= 0) {
    setFlash(
      "orders",
      "error",
      "Ese producto no tiene cantidad pendiente para generar un pedido operativo.",
    );
    render();
    return;
  }

  let updated = false;
  const createdAt = new Date().toISOString();
  let targetOrder =
    state.kitchenOrders.find(
      (order) =>
        order.status === "pendiente" &&
        order.forwardedToDispatch !== true &&
        order.branchId === branch.id &&
        normalizeBranchBrand(order.brandName) === normalizedBrandName,
    ) || null;

  if (!targetOrder) {
    targetOrder = {
      id: createId("kitchen-order"),
      number: createKitchenOrderNumber(),
      branchId: branch.id,
      branchName: branch.name,
      brandName: normalizedBrandName,
      requesterId: requester.id,
      requesterName: requester.name,
      requesterRole: requester.role,
      authorizedById: requester.id,
      authorizedByName: requester.name,
      authorizedByRole: normalizeCollaboratorRole(requester.role),
      origin: "Pedidos",
      destination: `${branch.name} / ${normalizedBrandName}`,
      status: "pendiente",
      date: today(),
      createdAt,
      forwardedToDispatch: false,
      forwardedAt: "",
      forwardedById: "",
      forwardedByName: "",
      forwardedByRole: "",
      sentToKitchen: false,
      sentToKitchenAt: "",
      sentToKitchenById: "",
      sentToKitchenByName: "",
      sentToKitchenByRole: "",
      items: [],
    };
    state.kitchenOrders.unshift(targetOrder);
  }

  const existingItem = targetOrder.items.find((item) => item.productId === product.id);
  if (existingItem) {
    existingItem.requested = roundStock(existingItem.requested + requestedQuantity);
    existingItem.pending = roundStock(existingItem.pending + requestedQuantity);
  } else {
    targetOrder.items.push({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      requested: requestedQuantity,
      delivered: 0,
      pending: requestedQuantity,
      workedInKitchen: false,
      workedAt: "",
    });
  }

  state.branchNeeds = state.branchNeeds.map((branchNeed) => {
    if (
      branchNeed.branchId !== branchId ||
      normalizeBranchBrand(branchNeed.brandName) !== normalizedBrandName
    ) {
      return branchNeed;
    }

    updated = true;
    return {
      ...branchNeed,
      productIds: branchNeed.productIds.filter((currentProductId) => currentProductId !== productId),
      updatedAt: createdAt,
    };
  });

  if (!updated) {
    setFlash("orders", "error", "Ese pedido ya no estaba disponible para enviarse.");
    render();
    return;
  }

  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "orders",
    "success",
    `Pedido enviado para ${branch.name} / ${normalizedBrandName}. ${product.name} ya aparece en Pedidos enviados.`,
  );
  render();
}

function toggleBranchCatalogProduct(branchId, brandName, productId) {
  const branch = getBranchLocationById(branchId);
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const product = getProductById(productId);

  if (!branch || !normalizedBrandName || !product) {
    return;
  }

  if (!canEditBranchStoreStock(branchId)) {
    setFlash(
      "branches",
      "error",
      `Solo el Lider de turno asignado a ${branch.name} puede distribuir productos a las marcas.`,
    );
    render();
    return;
  }

  const updatedAt = new Date().toISOString();
  let nowAssigned = false;

  state.branchCatalogs = (state.branchCatalogs || defaultBranchCatalogs()).map((branchCatalog) => {
    if (
      branchCatalog.branchId !== branchId ||
      normalizeBranchBrand(branchCatalog.brandName) !== normalizedBrandName
    ) {
      return branchCatalog;
    }

    const nextProductIds = new Set(branchCatalog.productIds || []);
    if (nextProductIds.has(productId)) {
      nextProductIds.delete(productId);
      nowAssigned = false;
    } else {
      nextProductIds.add(productId);
      nowAssigned = true;
    }

    return {
      ...branchCatalog,
      brandName: normalizedBrandName,
      productIds: [...nextProductIds],
      updatedAt,
    };
  });

  if (!nowAssigned) {
    state.branchNeeds = state.branchNeeds.map((branchNeed) => {
      if (
        branchNeed.branchId !== branchId ||
        normalizeBranchBrand(branchNeed.brandName) !== normalizedBrandName
      ) {
        return branchNeed;
      }

      const nextStockByProductId = { ...(branchNeed.stockByProductId || {}) };
      delete nextStockByProductId[productId];

      return {
        ...branchNeed,
        productIds: branchNeed.productIds.filter((currentProductId) => currentProductId !== productId),
        stockByProductId: nextStockByProductId,
        updatedAt,
      };
    });
  }

  reconcileNotificationsWithInventory();
  saveState();
  setFlash(
    "branches",
    "success",
    nowAssigned
      ? `${product.name} ahora esta disponible en ${branch.name} / ${normalizedBrandName}.`
      : `${product.name} ya no aparecera en ${branch.name} / ${normalizedBrandName}.`,
  );
  render();
}

function updateBranchProductStoreStock(branchId, brandName, productId, rawValue) {
  const branchExists = Boolean(getBranchLocationById(branchId));
  const normalizedBrandName = normalizeBranchBrand(brandName);
  const product = getProductById(productId);

  if (!branchExists || !normalizedBrandName || !product) {
    return;
  }

  if (!canEditBranchStoreStock(branchId)) {
    setFlash("branches", "error", "Solo el Lider de turno asignado a esta sucursal puede actualizar el Stock de tienda.");
    render();
    return;
  }

  const trimmedValue = String(rawValue ?? "").trim();
  const hasValue = trimmedValue !== "";
  const nextStock = hasValue ? roundStock(normalizeNumber(trimmedValue, Number.NaN)) : null;

  if (hasValue && (!Number.isFinite(nextStock) || nextStock < 0)) {
    return;
  }

  const updatedAt = new Date().toISOString();
  state.branchNeeds = state.branchNeeds.map((branchNeed) =>
    branchNeed.branchId === branchId &&
    normalizeBranchBrand(branchNeed.brandName) === normalizedBrandName
      ? {
          ...branchNeed,
          brandName: normalizedBrandName,
          updatedAt,
        }
      : branchNeed,
  );
  setBranchStoreStockValue(branchId, productId, hasValue ? nextStock : null, updatedAt);

  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function updateBranchConsumptionStoreStock(branchId, productId, rawValue) {
  const branchExists = Boolean(getBranchLocationById(branchId));
  const product = getProductById(productId);

  if (!branchExists || !product) {
    return;
  }

  if (!canEditBranchStoreStock(branchId)) {
    setFlash("branches", "error", "Solo el Lider de turno asignado a esta sucursal puede actualizar el consumo de tienda.");
    render();
    return;
  }

  const trimmedValue = String(rawValue ?? "").trim();
  const hasValue = trimmedValue !== "";
  const nextStock = hasValue ? roundStock(normalizeNumber(trimmedValue, Number.NaN)) : null;

  if (hasValue && (!Number.isFinite(nextStock) || nextStock < 0)) {
    return;
  }

  setBranchConsumptionValue(branchId, productId, hasValue ? nextStock : null, new Date().toISOString());
  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function updateBranchDailyQuantity(branchId, productId, rawValue) {
  const branchExists = Boolean(getBranchLocationById(branchId));
  const product = getProductById(productId);

  if (!branchExists || !product) {
    return;
  }

  if (!canEditBranchStoreStock(branchId)) {
    setFlash("branches", "error", "Solo el Lider de turno asignado a esta sucursal puede actualizar la cantidad diaria.");
    render();
    return;
  }

  const trimmedValue = String(rawValue ?? "").trim();
  const hasValue = trimmedValue !== "";
  const nextQuantity = hasValue ? roundStock(normalizeNumber(trimmedValue, Number.NaN)) : null;

  if (hasValue && (!Number.isFinite(nextQuantity) || nextQuantity < 0)) {
    return;
  }

  const updatedAt = new Date().toISOString();
  setBranchDailyQuantityValue(branchId, productId, hasValue ? nextQuantity : null, updatedAt);
  if (hasValue) {
    setBranchStoreStockValue(branchId, productId, nextQuantity, updatedAt);
  }
  reconcileNotificationsWithInventory();
  saveState();
  render();
}

function getNotificationIdentityKey(notification) {
  const sourceType = normalizeNotificationSourceType(notification?.sourceType, notification);

  if (sourceType === "branch_stock") {
    return [
      sourceType,
      String(notification?.branchId || ""),
      normalizeBranchBrand(notification?.brandName),
      String(notification?.productId || ""),
    ].join("|");
  }

  return [sourceType, String(notification?.productId || "")].join("|");
}

function getSortedNotifications() {
  return [...getPendingNotifications()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function getCompletedTaskNotifications() {
  return state.notifications.filter(
    (notification) =>
      notification.taskRequired === true &&
      notification.status === "completada" &&
      getNotificationDurationMs(notification) !== null,
  );
}

function getNotificationDurationMs(notification) {
  if (!notification?.createdAt || !notification?.completedAt) {
    return null;
  }

  const start = new Date(notification.createdAt).getTime();
  const end = new Date(notification.completedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  return Math.max(end - start, 0);
}

function getAverageNotificationDurationMs(notifications) {
  const durations = notifications
    .map((notification) => getNotificationDurationMs(notification))
    .filter((duration) => typeof duration === "number");

  if (durations.length === 0) {
    return 0;
  }

  return durations.reduce((total, duration) => total + duration, 0) / durations.length;
}

function getProductConsumptionMetrics() {
  return getSortedProducts()
    .map((product) => {
      const exits = state.history.filter(
        (record) => record.type === "salida" && record.productId === product.id,
      );
      const exitCount = exits.length;
      const lowStockHits = exits.filter((record) => record.stockAfter < record.stockIdeal).length;
      const totalOutput = exits.reduce((total, record) => total + normalizeNumber(record.quantity), 0);

      return {
        productId: product.id,
        name: product.name,
        unit: product.unit,
        exitCount,
        lowStockHits,
        totalOutput: roundStock(totalOutput),
        score: lowStockHits * 3 + exitCount,
      };
    })
    .filter((metric) => metric.exitCount > 0 || metric.lowStockHits > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.totalOutput !== left.totalOutput) {
        return right.totalOutput - left.totalOutput;
      }

      return left.name.localeCompare(right.name, "es");
    });
}

function getCollaboratorSpeedMetrics() {
  const metrics = new Map();

  getCompletedTaskNotifications().forEach((notification) => {
    const duration = getNotificationDurationMs(notification);
    if (duration === null) {
      return;
    }

    notification.collaboratorNames.forEach((name) => {
      const trimmedName = String(name || "").trim();
      if (!trimmedName) {
        return;
      }

      const current = metrics.get(trimmedName) || {
        name: trimmedName,
        totalDurationMs: 0,
        taskCount: 0,
      };

      current.totalDurationMs += duration;
      current.taskCount += 1;
      metrics.set(trimmedName, current);
    });
  });

  return [...metrics.values()]
    .map((metric) => ({
      ...metric,
      averageDurationMs: metric.taskCount > 0 ? metric.totalDurationMs / metric.taskCount : 0,
    }))
    .sort((left, right) => {
      if (left.averageDurationMs !== right.averageDurationMs) {
        return left.averageDurationMs - right.averageDurationMs;
      }

      if (right.taskCount !== left.taskCount) {
        return right.taskCount - left.taskCount;
      }

      return left.name.localeCompare(right.name, "es");
    });
}

function getLongestPendingNotification() {
  return getSortedNotifications().reduce((longest, notification) => {
    if (!longest) {
      return notification;
    }

    return getElapsedMs(notification.createdAt) > getElapsedMs(longest.createdAt)
      ? notification
      : longest;
  }, null);
}

function getRecentHistoryByType(type) {
  return state.history.filter((record) => record.type === type).slice(0, 6);
}

function getFilteredProducts() {
  const query = ui.productSearch.trim().toLowerCase();
  if (!query) {
    return getSortedProducts();
  }

  return getSortedProducts().filter((product) =>
    [product.name, product.unit, product.category, product.status].join(" ").toLowerCase().includes(query),
  );
}

function getFilteredHistory() {
  const query = ui.historySearch.trim().toLowerCase();

  return [...state.history]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .filter((record) => {
      const matchesDate = ui.historyDate ? record.date === ui.historyDate : true;
      const haystack = [
        record.type,
        record.date,
        record.productName,
        record.quantity,
        record.unit,
        record.collaboratorName,
        record.destination,
        record.notificationMessage,
        record.observation,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery = query ? haystack.includes(query) : true;
      return matchesDate && matchesQuery;
    });
}

function normalizeNotificationStatus(status) {
  if (status === "inactive") {
    return "inactive";
  }

  if (status === "active") {
    return "active";
  }

  if (status === "en_progreso") {
    return "en_progreso";
  }

  if (status === "completada") {
    return "completada";
  }

  return "pendiente";
}

function normalizeNotificationSourceType(sourceType, notification = null) {
  const normalizedValue = String(sourceType || "")
    .trim()
    .toLowerCase();

  if (normalizedValue === "branch_stock") {
    return "branch_stock";
  }

  if (normalizedValue === "cold_room") {
    return "cold_room";
  }

  if (notification && notification.branchId && normalizeBranchBrand(notification.brandName)) {
    return "branch_stock";
  }

  return "cold_room";
}

function normalizeCollaboratorRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const normalizedBase = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (!normalizedBase) {
    return "";
  }

  if (normalizedBase.includes("admin")) {
    return "administrador";
  }

  if (normalizedBase.includes("encarg")) {
    return "encargado";
  }

  if (normalizedBase.includes("cocin")) {
    return "cocinero";
  }

  if (normalizedBase.includes("util")) {
    return "utility";
  }

  if (normalizedBase.includes("lider")) {
    return "lider_de_turno";
  }

  return "";
}

function formatCollaboratorRole(roleValue) {
  const role = COLLABORATOR_ROLES.find((item) => item.value === normalizeCollaboratorRole(roleValue));
  return role ? role.label : "Sin rol";
}

function normalizeCollaboratorBranch(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) {
    return "";
  }

  if (normalized === "todas") {
    return ALL_BRANCHES_OPTION;
  }

  const branch = BRANCH_LOCATIONS.find(
    (item) =>
      item.name
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") === normalized,
  );

  return branch ? branch.name : "";
}

function renderCollaboratorBranchOptions(selectedValue = "") {
  const normalizedSelectedValue = normalizeCollaboratorBranch(selectedValue);

  return [
    `
      <option value="${escapeHtml(ALL_BRANCHES_OPTION)}" ${normalizedSelectedValue === ALL_BRANCHES_OPTION ? "selected" : ""}>
        ${escapeHtml(ALL_BRANCHES_OPTION)}
      </option>
    `,
    ...BRANCH_LOCATIONS.map(
      (branch) => `
        <option value="${escapeHtml(branch.name)}" ${normalizedSelectedValue === branch.name ? "selected" : ""}>
          ${escapeHtml(branch.name)}
        </option>
      `,
    ),
  ].join("");
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundStock(value) {
  return Math.round(value * 100) / 100;
}

function today() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().split("T")[0];
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return "sin fecha";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "sin fecha";
  }

  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-DO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalizeNumber(value));
}

function getElapsedMs(startValue, endValue = "") {
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  return Math.max(end - start, 0);
}

function formatElapsedTime(durationMs) {
  const safeDuration = Math.max(Math.floor(durationMs / 1000), 0);
  const hours = Math.floor(safeDuration / 3600);
  const minutes = Math.floor((safeDuration % 3600) / 60);
  const seconds = safeDuration % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTimerText(startValue, endValue, liveLabel, doneLabel) {
  const completed = Boolean(endValue);
  const label = completed ? doneLabel : liveLabel;
  return `${label}: ${formatElapsedTime(getElapsedMs(startValue, endValue))}`;
}

function updateLiveTimers() {
  if (!app) {
    return;
  }

  app.querySelectorAll("[data-timer-start]").forEach((element) => {
    const startValue = element.getAttribute("data-timer-start") || "";
    const endValue = element.getAttribute("data-timer-end") || "";
    const liveLabel = element.getAttribute("data-timer-label-live") || "Tiempo";
    const doneLabel = element.getAttribute("data-timer-label-done") || "Tiempo final";
    element.textContent = renderTimerText(startValue, endValue, liveLabel, doneLabel);
  });
}

function formatChartWidth(value, maxValue) {
  if (!value || value <= 0 || !maxValue || maxValue <= 0) {
    return "0%";
  }

  return `${Math.max((value / maxValue) * 100, 8)}%`;
}

function createId(prefix) {
  const randomSegment =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomSegment}`;
}


