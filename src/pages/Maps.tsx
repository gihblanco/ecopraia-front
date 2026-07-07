import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import Swal from "sweetalert2";
import { MapView } from "@/components/Map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Loader2,
  MapPin,
  Navigation,
  X,
  Car,
  Bike,
  Footprints,
  LogIn,
  LogOut,
} from "lucide-react";
import {
  getInformativosAll,
  getLixeirasAll,
  postLixeiras,
  putLixeiras,
  deleteLixeiras,
  getLixeiraDistancia,
  getLixeiraRota,
  isAuthenticated,
  isAdmin,
  getRole,
  fetchCurrentUserRole,
} from "@/lib/api";
import "./Maps.css";

interface TrashLocation {
  id: string;
  lat: number;
  lng: number;
  name: string;
  beach: string;
  types: string[];
  address: string;
  source: "backend" | "static";
}

interface TrashRegistration {
  name: string;
  beach: string;
  types: string[];
  address: string;
  lat: number;
  lng: number;
}

interface WasteTypeOption {
  id: number;
  nomeTipo: string;
  cor: string;
}

const DEFAULT_WASTE_TYPE_COLORS: Record<string, string> = {
  Papel: "#457B9D",
  Plástico: "#E63946",
  Vidro: "#2A9D8F",
  Metal: "#F4A261",
  Orgânico: "#8B7355",
};

const STORAGE_KEY_LIXEIRA_TYPES = "ecopraia:lixeira-types";

const DEFAULT_WASTE_TYPES: WasteTypeOption[] = [
  { id: 1, nomeTipo: "Plástico", cor: DEFAULT_WASTE_TYPE_COLORS.Plástico },
  { id: 2, nomeTipo: "Vidro", cor: DEFAULT_WASTE_TYPE_COLORS.Vidro },
  { id: 3, nomeTipo: "Papel", cor: DEFAULT_WASTE_TYPE_COLORS.Papel },
  { id: 4, nomeTipo: "Orgânico", cor: DEFAULT_WASTE_TYPE_COLORS.Orgânico },
  { id: 5, nomeTipo: "Metal", cor: DEFAULT_WASTE_TYPE_COLORS.Metal },
];

function loadSavedLixeiraTypes(): Record<string, string[]> {
  const raw = localStorage.getItem(STORAGE_KEY_LIXEIRA_TYPES);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key,
          Array.isArray(value)
            ? value.filter(item => typeof item === "string")
            : [],
        ])
      );
    }
  } catch {}

  return {};
}

function persistSavedLixeiraTypes(data: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY_LIXEIRA_TYPES, JSON.stringify(data));
}

function saveLixeiraTypes(id: string, types: string[]) {
  const current = loadSavedLixeiraTypes();
  if (types.length > 0) {
    current[id] = types;
  } else {
    delete current[id];
  }
  persistSavedLixeiraTypes(current);
}

function removeSavedLixeiraTypes(id: string) {
  const current = loadSavedLixeiraTypes();
  if (id in current) {
    delete current[id];
    persistSavedLixeiraTypes(current);
  }
}

function getSavedLixeiraTypes(id: string): string[] | undefined {
  return loadSavedLixeiraTypes()[id];
}

function extractWasteTypeNames(
  item: any,
  wasteTypes: WasteTypeOption[]
): string[] {
  const normalizeType = (tipo: any): string | null => {
    if (tipo == null) return null;
    if (typeof tipo === "string") return tipo;
    if (typeof tipo === "number") {
      return (
        wasteTypes.find(type => type.id === tipo)?.nomeTipo ?? String(tipo)
      );
    }
    if (typeof tipo === "object") {
      const candidateName = tipo?.nomeTipo ?? tipo?.nome ?? tipo?.tipo ?? null;
      if (candidateName) return candidateName;
      if (tipo?.id != null) {
        const id = Number(tipo.id);
        if (!Number.isNaN(id)) {
          return (
            wasteTypes.find(type => type.id === id)?.nomeTipo ?? String(id)
          );
        }
      }
    }
    return null;
  };

  const candidateArrays: any[] = [
    item?.informativosTipos,
    item?.tipos,
    item?.informativos,
    item?.residuosTipos,
    item?.tiposResiduos,
  ].filter(value => Array.isArray(value) && value.length > 0);

  const source = candidateArrays[0] ?? [];

  const names = source
    .map(normalizeType)
    .filter((name: string | null): name is string => Boolean(name));

  if (names.length > 0) {
    return names;
  }

  const fallbackIds = Array.isArray(item?.informativosTiposIds)
    ? item.informativosTiposIds
    : Array.isArray(item?.informativosTipos)
      ? item.informativosTipos
      : [];

  const resolvedNames = fallbackIds
    .map((maybeId: any) => Number(maybeId))
    .filter((id: number) => !Number.isNaN(id))
    .map(
      (id: number) =>
        wasteTypes.find(type => type.id === id)?.nomeTipo ?? String(id)
    );

  if (resolvedNames.length > 0) {
    return resolvedNames;
  }

  if (
    (Array.isArray(item?.informativosTiposIds) &&
      item.informativosTiposIds.length > 0) ||
    (Array.isArray(item?.informativosTipos) &&
      item.informativosTipos.length > 0)
  ) {
    console.warn(
      "[MapsPage] Lixeira veio com informativosTipos/informativosTiposIds mas não foi possível resolver os nomes dos tipos. Confira o formato exato da resposta de " +
        "GET /lixeiras/todos e ajuste extractWasteTypeNames() se o campo tiver outro nome:",
      item,
      "item informativosTipos:",
      item?.informativosTipos,
      "item informativosTiposIds:",
      item?.informativosTiposIds,
      "available wasteTypes:",
      wasteTypes
    );
  }

  return names;
}

function mapBackendLixeiraToTrashLocation(
  item: any,
  wasteTypes: WasteTypeOption[],
  savedTypesById: Record<string, string[]> = {}
): TrashLocation {
  const resolvedTypes = extractWasteTypeNames(item, wasteTypes);
  const savedTypes = item?.id ? (savedTypesById[String(item.id)] ?? []) : [];
  const types = resolvedTypes.length > 0 ? resolvedTypes : savedTypes;

  return {
    id: String(item?.id ?? Date.now()),
    lat: Number(item?.latitude ?? 0),
    lng: Number(item?.longitude ?? 0),
    name:
      types.length > 0 ? `Lixeira ${types.join(" / ")}` : "Lixeira cadastrada",
    beach: types.length > 0 ? "Tipos cadastrados" : "Local cadastrado",
    types,
    address:
      types.length > 0
        ? `Tipos: ${types.join(", ")}`
        : `Lat ${item?.latitude ?? 0}, Lng ${item?.longitude ?? 0}`,
    source: "backend",
  };
}

type TransportMode = "driving" | "cycling" | "walking";

const TRANSPORT_MODES: {
  value: TransportMode;
  label: string;
  icon: typeof Car;
}[] = [{ value: "walking", label: "A pé", icon: Footprints }];

const TRANSPORT_MODE_TO_BACKEND: Record<
  TransportMode,
  "A_PE" | "BICICLETA" | "CARRO"
> = {
  walking: "A_PE",
  cycling: "BICICLETA",
  driving: "CARRO",
};

const TRASH_LOCATIONS: TrashLocation[] = [
  {
    id: "1",
    lat: -27.6032,
    lng: -48.4354,
    name: "Lixeiras Praia Mole",
    beach: "Praia Mole",
    types: ["Plástico", "Vidro", "Papel"],
    address: "Faixa de areia central - Praia Mole",
    source: "static",
  },

  {
    id: "2",
    lat: -27.6047,
    lng: -48.4589,
    name: "Lixeiras Lagoa da Conceição",
    beach: "Lagoa da Conceição",
    types: ["Plástico", "Orgânico", "Metal"],
    address: "Centrinho da Lagoa da Conceição",
    source: "static",
  },

  {
    id: "3",
    lat: -27.3993,
    lng: -48.4154,
    name: "Lixeiras Praia Brava",
    beach: "Praia Brava",
    types: ["Vidro", "Papel", "Metal"],
    address: "Faixa de areia central - Praia Brava",
    source: "static",
  },

  {
    id: "4",
    lat: -27.6946,
    lng: -48.4779,
    name: "Lixeiras Praia do Campeche",
    beach: "Praia do Campeche",
    types: ["Plástico", "Vidro", "Orgânico"],
    address: "Faixa de areia central - Praia do Campeche",
    source: "static",
  },

  {
    id: "5",
    lat: -27.6288,
    lng: -48.4492,
    name: "Lixeiras Praia da Joaquina",
    beach: "Praia da Joaquina",
    types: ["Plástico", "Papel", "Metal"],
    address: "Faixa de areia central - Praia da Joaquina",
    source: "static",
  },

  {
    id: "6",
    lat: -27.4518,
    lng: -48.3706,
    name: "Lixeiras Praia do Santinho",
    beach: "Praia do Santinho",
    types: ["Plástico", "Orgânico", "Metal"],
    address: "Faixa de areia central - Praia do Santinho",
    source: "static",
  },

  {
    id: "7",
    lat: -27.5748,
    lng: -48.4268,
    name: "Lixeiras Barra da Lagoa",
    beach: "Barra da Lagoa",
    types: ["Vidro", "Papel", "Orgânico"],
    address: "Faixa de areia central - Barra da Lagoa",
    source: "static",
  },

  {
    id: "8",
    lat: -27.4307,
    lng: -48.5123,
    name: "Lixeiras Praia do Forte",
    beach: "Praia do Forte",
    types: ["Plástico", "Vidro", "Metal"],
    address: "Faixa de areia central - Praia do Forte",
    source: "static",
  },
];

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours}h ${minutes}min`;
}

function getAverageSpeed(mode: TransportMode) {
  switch (mode) {
    case "walking":
      return 4.5;

    case "cycling":
      return 14;

    case "driving":
      return 35;

    default:
      return 4.5;
  }
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`,
      { headers: { "Accept-Language": "pt-BR" } }
    );

    if (!response.ok) {
      throw new Error(`Nominatim request failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.display_name ?? "";
  } catch (error) {
    console.error("Erro ao buscar endereço via reverse geocoding:", error);
    return "";
  }
}

export default function MapsPage() {
  const navigate = useNavigate();
  const mapRef = useRef<any>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditingTrash, setIsEditingTrash] = useState(false);
  const [editingTrashId, setEditingTrashId] = useState<string | null>(null);
  const [editingTrashSource, setEditingTrashSource] = useState<
    "backend" | "static" | null
  >(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedTrash, setSelectedTrash] = useState<TrashLocation | null>(
    null
  );
  const [showRouting, setShowRouting] = useState(false);
  const [routeDistance, setRouteDistance] = useState<string | null>(null);
  const [routeDuration, setRouteDuration] = useState<string | null>(null);
  const [transportMode, setTransportMode] = useState<TransportMode>("walking");
  const [formData, setFormData] = useState<Partial<TrashRegistration>>({
    name: "",
    beach: "",
    address: "",
  });
  const [extraTrashes, setExtraTrashes] = useState<TrashLocation[]>([]);
  const [serverTrashes, setServerTrashes] = useState<TrashLocation[]>([]);
  const [wasteTypes, setWasteTypes] =
    useState<WasteTypeOption[]>(DEFAULT_WASTE_TYPES);
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [isAuthenticated_, setIsAuthenticated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (selectedTrash) {
      console.log("[MapsPage] selectedTrash.types:", selectedTrash.types);
    }
  }, [selectedTrash, wasteTypes]);
  const [isAdmin_, setIsAdmin] = useState(false);
  const [isRoutingLoading, setIsRoutingLoading] = useState(false);
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);
  const positionsRef = useRef<GeolocationCoordinates[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const adminPinMarkerRef = useRef<maplibregl.Marker | null>(null);
  const geocodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  }, []);

  const renderMarkers = useCallback(
    (locations: TrashLocation[]) => {
      const map = mapRef.current;
      if (!map) return;

      clearMarkers();

      locations.forEach(location => {
        const marker = new maplibregl.Marker({ color: "#FF6B35" })
          .setLngLat([location.lng, location.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              `
                <div style="padding: 12px; font-family: Inter, sans-serif;">
                  <h3 style="margin: 0 0 8px 0; font-weight: bold;">${location.name}</h3>
                  <p style="margin: 0 0 8px 0; color: #666; font-size: 12px;">${location.address}</p>
                  <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${location.types
                      .map(
                        type =>
                          `<span style="background: ${DEFAULT_WASTE_TYPE_COLORS[type] ?? "#64748b"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">${type}</span>`
                      )
                      .join("")}
                  </div>
                </div>
              `
            )
          )
          .addTo(map);

        marker.getElement().addEventListener("click", () => {
          setSelectedTrash(location);
        });

        markersRef.current.push(marker);
      });
    },
    [clearMarkers]
  );

  const removeAdminPin = useCallback(() => {
    if (adminPinMarkerRef.current) {
      adminPinMarkerRef.current.remove();
      adminPinMarkerRef.current = null;
    }
    if (geocodeDebounceRef.current) {
      clearTimeout(geocodeDebounceRef.current);
      geocodeDebounceRef.current = null;
    }
  }, []);

  const scheduleGeocodeFromPin = useCallback((lat: number, lng: number) => {
    if (geocodeDebounceRef.current) {
      clearTimeout(geocodeDebounceRef.current);
    }

    setIsGeocodingAddress(true);

    geocodeDebounceRef.current = setTimeout(async () => {
      const address = await reverseGeocode(lat, lng);
      setFormData(prev => ({ ...prev, address: address || prev.address }));
      setIsGeocodingAddress(false);
      geocodeDebounceRef.current = null;
    }, 600);
  }, []);

  const placeAdminPin = useCallback(
    (lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;

      removeAdminPin();

      const marker = new maplibregl.Marker({
        color: "#f97316",
        draggable: true,
      })
        .setLngLat([lng, lat])
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(
            `<div style="padding: 8px; font-family: Inter, sans-serif; font-size: 12px;">
               Arraste para o ponto exato da lixeira
             </div>`
          )
        )
        .addTo(map);

      marker.togglePopup();

      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        setFormData(prev => ({ ...prev, lat: pos.lat, lng: pos.lng }));
        scheduleGeocodeFromPin(pos.lat, pos.lng);
      });

      adminPinMarkerRef.current = marker;

      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 17),
        duration: 600,
      });
    },
    [removeAdminPin, scheduleGeocodeFromPin]
  );

  useEffect(() => {
    const syncAuthState = async () => {
      const isAuth = isAuthenticated();
      setIsAuthenticated(isAuth);

      let role = getRole();
      if (isAuth && !role) {
        role = await fetchCurrentUserRole();
      }

      setIsAdmin(isAdmin());
    };

    void syncAuthState();
    window.addEventListener("storage", syncAuthState);

    const loadTrashLocations = async () => {
      try {
        const [lixeirasResponse, informativosResponse] = await Promise.all([
          getLixeirasAll(),
          getInformativosAll(),
        ]);

        const backendLixeiras = Array.isArray(lixeirasResponse.data)
          ? lixeirasResponse.data
          : [];
        const backendInformativos = Array.isArray(informativosResponse.data)
          ? informativosResponse.data
          : [];

        console.log("[MapsPage] backendLixeiras raw:", backendLixeiras);
        console.log("[MapsPage] backendInformativos raw:", backendInformativos);
        console.log(
          "[MapsPage] first lixeira fields:",
          backendLixeiras[0] ? Object.keys(backendLixeiras[0]) : null,
          "informativosTipos:",
          backendLixeiras[0]?.informativosTipos,
          "informativosTiposIds:",
          backendLixeiras[0]?.informativosTiposIds
        );

        const savedTypesById = loadSavedLixeiraTypes();

        const normalizedTypes =
          backendInformativos.length > 0
            ? backendInformativos.map((item: any) => ({
                id: Number(item?.id),
                nomeTipo: item?.nomeTipo ?? "Tipo",
                cor:
                  item?.cor ??
                  DEFAULT_WASTE_TYPE_COLORS[item?.nomeTipo] ??
                  "#64748b",
              }))
            : DEFAULT_WASTE_TYPES;

        setWasteTypes(normalizedTypes);

        const mappedLixeiras = backendLixeiras.map(item =>
          mapBackendLixeiraToTrashLocation(
            item,
            normalizedTypes,
            savedTypesById
          )
        );
        setServerTrashes(mappedLixeiras);
      } catch (error) {
        console.error("Erro ao carregar lixeiras do backend:", error);
      }
    };

    void loadTrashLocations();

    return () => {
      window.removeEventListener("storage", syncAuthState);
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      renderMarkers([...TRASH_LOCATIONS, ...serverTrashes, ...extraTrashes]);
    }
  }, [extraTrashes, renderMarkers, serverTrashes]);

  useEffect(() => {
    return () => {
      removeAdminPin();
    };
  }, [removeAdminPin]);

  useEffect(() => {
    const FALLBACK_LOCATION = { lat: -27.5954, lng: -48.5477 };
    const GOOD_ACCURACY_METERS = 25;
    const MAX_WAIT_MS = 8000;

    let watchId: number | undefined;
    let receivedAnyLocation = false;
    let lastErrorAlertAt = 0;

    const applyFallback = () => {
      if (!receivedAnyLocation) {
        setUserLocation(FALLBACK_LOCATION);
      }
    };

    const handlePosition = (position: GeolocationPosition) => {
      const coords = position.coords;
      console.log("Precisão atual:", coords.accuracy, "m");

      receivedAnyLocation = true;

      if (coords.accuracy <= GOOD_ACCURACY_METERS) {
        setUserLocation({ lat: coords.latitude, lng: coords.longitude });

        positionsRef.current = [];
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return;
      }

      positionsRef.current.push(coords);

      if (timeoutRef.current) return;

      timeoutRef.current = setTimeout(() => {
        if (positionsRef.current.length === 0) {
          timeoutRef.current = null;
          return;
        }

        const best = positionsRef.current.reduce((a, b) =>
          a.accuracy < b.accuracy ? a : b
        );

        console.log("Usando melhor precisão disponível:", best.accuracy, "m");

        setUserLocation({ lat: best.latitude, lng: best.longitude });

        positionsRef.current = [];
        timeoutRef.current = null;
      }, MAX_WAIT_MS);
    };

    const handleError = (error: GeolocationPositionError) => {
      console.error("Erro de geolocalização:", error.code, error.message);

      const now = Date.now();
      if (now - lastErrorAlertAt > 10000) {
        lastErrorAlertAt = now;

        if (error.code === error.PERMISSION_DENIED) {
          Swal.fire({
            title: "Permissão bloqueada",
            text: "A localização foi bloqueada nas configurações do navegador. Habilite o acesso à localização para este site para obter rotas precisas.",
            icon: "warning",
            confirmButtonColor: "#22c55e",
          });
        } else if (!receivedAnyLocation) {
          Swal.fire({
            title: "Localização aproximada",
            text: "Não foi possível obter sua localização exata agora. Usaremos uma localização aproximada e tentaremos melhorar automaticamente.",
            icon: "warning",
            confirmButtonColor: "#22c55e",
          });
        }
      }

      applyFallback();
    };

    const startWatching = () => {
      navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });

      watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        }
      );
    };

    const requestLocationPermission = async () => {
      if (!navigator.geolocation) {
        applyFallback();
        return;
      }

      if (!window.isSecureContext) {
        console.warn(
          "Geolocalização de alta precisão requer HTTPS (ou localhost). Usando localização aproximada."
        );
        applyFallback();
        return;
      }

      let permissionState: PermissionState | null = null;
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({
            name: "geolocation" as PermissionName,
          });
          permissionState = status.state;
        }
      } catch {
        permissionState = null;
      }

      if (permissionState === "denied") {
        Swal.fire({
          title: "Localização bloqueada",
          text: "Você bloqueou o acesso à localização anteriormente. Habilite o acesso ao site nas configurações do navegador para uma rota mais precisa.",
          icon: "warning",
          confirmButtonColor: "#22c55e",
        });
        applyFallback();
        return;
      }

      if (permissionState === "granted") {
        startWatching();
        return;
      }

      try {
        const result = await Swal.fire({
          title: "Localização",
          text: "Deseja permitir que a aplicação acesse sua localização para centralizar o mapa e calcular rotas com precisão?",
          icon: "question",
          showCancelButton: true,
          confirmButtonColor: "#22c55e",
          cancelButtonColor: "#ef4444",
          confirmButtonText: "Permitir",
          cancelButtonText: "Recusar",
          allowOutsideClick: false,
        });

        if (!result.isConfirmed) {
          applyFallback();
          return;
        }
      } catch (error) {
        console.error(error);
        applyFallback();
        return;
      }

      startWatching();
    };

    requestLocationPermission();

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const clearRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      const routeSource = map.getSource("route") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (routeSource) {
        const empty = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: {},
        } as GeoJSON.Feature<GeoJSON.LineString>;
        routeSource.setData(empty);
      }
    } catch (error) {
      console.error("Erro ao limpar rota:", error);
    }
  }, []);

  const updateRoute = useCallback(
    async (from: { lat: number; lng: number }, trash: TrashLocation) => {
      const map = mapRef.current;
      if (!map) return;

      const to = { lat: trash.lat, lng: trash.lng };

      setIsRoutingLoading(true);

      if (trash.source === "backend") {
        const numericId = Number(trash.id);

        if (!Number.isNaN(numericId)) {
          try {
            const modo = TRANSPORT_MODE_TO_BACKEND[transportMode];

            const [distanciaResponse, rotaResponse] = await Promise.all([
              getLixeiraDistancia(numericId, from.lat, from.lng),
              getLixeiraRota(numericId, from.lat, from.lng, modo),
            ]);

            const distData = distanciaResponse?.data ?? {};
            const rotaData = rotaResponse?.data ?? {};

            const distanceMeters: number | undefined =
              distData.distanciaMetros ??
              distData.distancia ??
              distData.distance ??
              undefined;

            const durationSeconds: number | undefined =
              distData.duracaoSegundos ??
              distData.duracao ??
              distData.duration ??
              undefined;

            const coordinates: [number, number][] | undefined =
              rotaData.coordenadas ??
              rotaData.coordinates ??
              rotaData?.geometry?.coordinates ??
              rotaData?.rota?.coordinates ??
              undefined;

            if (!coordinates || coordinates.length === 0) {
              throw new Error(
                "Resposta do backend não trouxe coordenadas de rota reconhecíveis"
              );
            }

            const routeSource = map.getSource("route") as
              | maplibregl.GeoJSONSource
              | undefined;
            if (routeSource) {
              routeSource.setData({
                type: "Feature",
                geometry: { type: "LineString", coordinates },
                properties: {},
              } as GeoJSON.Feature<GeoJSON.LineString>);
            }

            const bounds = coordinates.reduce(
              (acc, coord) => acc.extend(coord as [number, number]),
              new maplibregl.LngLatBounds(
                coordinates[0] as [number, number],
                coordinates[0] as [number, number]
              )
            );
            map.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 800 });

            if (distanceMeters != null) {
              const distanceKm = distanceMeters / 1000;
              setRouteDistance(`${distanceKm.toFixed(1)} km`);

              if (durationSeconds != null) {
                setRouteDuration(
                  formatDuration(Math.round(durationSeconds / 60))
                );
              } else {
                const speed = getAverageSpeed(transportMode);
                setRouteDuration(
                  formatDuration(Math.round((distanceKm / speed) * 60))
                );
              }
            }

            setIsRoutingLoading(false);
            return;
          } catch (backendError) {
            console.warn(
              "Rota via backend indisponível, usando OSRM público como alternativa:",
              backendError
            );
          }
        }
      }

      try {
        const profile =
          transportMode === "cycling"
            ? "cycling"
            : transportMode === "walking"
              ? "foot"
              : "driving";
        const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`OSRM request failed: ${response.status}`);
        }

        const data = await response.json();
        const coordinates = data?.routes?.[0]?.geometry?.coordinates as
          | [number, number][]
          | undefined;
        const distance = data?.routes?.[0]?.distance as number | undefined;

        if (!coordinates || coordinates.length === 0) {
          throw new Error("Nenhuma rota encontrada");
        }

        const routeSource = map.getSource("route") as
          | maplibregl.GeoJSONSource
          | undefined;
        if (routeSource) {
          const routeGeoJSON = {
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.LineString>;
          routeSource.setData(routeGeoJSON);
        }
        if (distance) {
          const distanceKm = distance / 1000;

          setRouteDistance(`${distanceKm.toFixed(1)} km`);

          const speed = getAverageSpeed(transportMode);

          const estimatedMinutes = Math.round((distanceKm / speed) * 60);

          setRouteDuration(formatDuration(estimatedMinutes));
        }

        const bounds = coordinates.reduce(
          (acc, coord) => acc.extend(coord as [number, number]),
          new maplibregl.LngLatBounds(
            coordinates[0] as [number, number],
            coordinates[0] as [number, number]
          )
        );

        map.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 800 });
      } catch (error) {
        console.error("Erro ao buscar rota:", error);
        clearRoute();

        const distanceMeters = Math.sqrt(
          Math.pow((from.lat - to.lat) * 111000, 2) +
            Math.pow(
              (from.lng - to.lng) *
                111000 *
                Math.cos((from.lat * Math.PI) / 180),
              2
            )
        );
        setRouteDistance(`${(distanceMeters / 1000).toFixed(1)} km`);
        const speedKmH =
          transportMode === "walking"
            ? 5
            : transportMode === "cycling"
              ? 15
              : 50;

        const fallbackMinutes = Math.round(
          (distanceMeters / 1000 / speedKmH) * 60
        );
        setRouteDuration(`${fallbackMinutes} min`);
      } finally {
        setIsRoutingLoading(false);
      }
    },
    [clearRoute, transportMode]
  );

  const handleMapReady = async (map: maplibregl.Map) => {
    setIsLoading(false);
    mapRef.current = map;

    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [],
          },
          properties: {},
        } as GeoJSON.Feature<GeoJSON.LineString>,
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });
    }

    renderMarkers([...TRASH_LOCATIONS, ...serverTrashes, ...extraTrashes]);

    map.setCenter([-48.5477, -27.5954]);
    map.setZoom(12);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocation) {
      map.setCenter([userLocation.lng, userLocation.lat]);
      map.setZoom(14);

      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
      } else {
        userMarkerRef.current = new maplibregl.Marker({ color: "#22c55e" })
          .setLngLat([userLocation.lng, userLocation.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              "<p>Sua localização</p>"
            )
          )
          .addTo(map);
      }
    }
  }, [userLocation]);

  useEffect(() => {
    if (showRouting && selectedTrash && userLocation) {
      updateRoute(userLocation, selectedTrash);
    } else if (!showRouting) {
      clearRoute();
      setRouteDistance(null);
      setRouteDuration(null);
    }
  }, [
    showRouting,
    selectedTrash,
    userLocation,
    updateRoute,
    clearRoute,
    transportMode,
  ]);

  const handleAddTrash = async () => {
    if (!isAuthenticated_) {
      Swal.fire({
        title: "Login necessário",
        text: "Entre na sua conta para cadastrar uma lixeira.",
        icon: "info",
        confirmButtonColor: "#22c55e",
        confirmButtonText: "Ir para login",
      }).then(result => {
        if (result.isConfirmed) {
          navigate("/login");
        }
      });
      return;
    }

    if (!isAdmin_) {
      Swal.fire({
        title: "Acesso restrito",
        text: "Apenas administradores podem cadastrar lixeiras.",
        icon: "warning",
        confirmButtonColor: "#22c55e",
      });
      return;
    }

    setIsEditingTrash(false);
    setEditingTrashId(null);
    setEditingTrashSource(null);
    setSelectedTypes([]);
    setSelectedTypeIds([]);
    setFormData({ name: "", beach: "", address: "" });

    if (userLocation) {
      setFormData(prev => ({
        ...prev,
        lat: userLocation.lat,
        lng: userLocation.lng,
      }));

      setIsDialogOpen(true);
      placeAdminPin(userLocation.lat, userLocation.lng);
      setIsGeocodingAddress(true);

      const address = await reverseGeocode(userLocation.lat, userLocation.lng);

      setFormData(prev => ({ ...prev, address: address || prev.address }));
      setIsGeocodingAddress(false);
      return;
    }

    setIsDialogOpen(true);
  };

  const handleEditTrash = async (location: TrashLocation) => {
    if (!isAdmin_) {
      Swal.fire({
        title: "Acesso restrito",
        text: "Apenas administradores podem editar lixeiras.",
        icon: "warning",
        confirmButtonColor: "#22c55e",
      });
      return;
    }

    setIsEditingTrash(true);
    setEditingTrashId(location.id);
    setEditingTrashSource(location.source);
    setSelectedTypes(location.types);
    setSelectedTypeIds(
      wasteTypes
        .filter(type => location.types.includes(type.nomeTipo))
        .map(type => type.id)
    );
    setFormData({
      name: location.name,
      beach: location.beach,
      address: location.address,
      lat: location.lat,
      lng: location.lng,
    });
    setIsDialogOpen(true);
    placeAdminPin(location.lat, location.lng);

    setIsGeocodingAddress(true);
    const address = await reverseGeocode(location.lat, location.lng);
    setFormData(prev => ({ ...prev, address: address || prev.address }));
    setIsGeocodingAddress(false);
  };

  const handleDeleteTrash = async () => {
    if (!isAdmin_ || !editingTrashId) return;

    if (editingTrashSource !== "backend") {
      Swal.fire({
        title: "Não é possível excluir",
        text: "Essa lixeira é apenas de demonstração e não existe no backend.",
        icon: "info",
        confirmButtonColor: "#22c55e",
      });
      return;
    }

    const confirmResult = await Swal.fire({
      title: "Excluir lixeira?",
      text: "Essa ação não pode ser desfeita.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Excluir",
      cancelButtonText: "Cancelar",
    });

    if (!confirmResult.isConfirmed) return;

    try {
      await deleteLixeiras({ id: editingTrashId });

      removeSavedLixeiraTypes(editingTrashId);
      setServerTrashes(current =>
        current.filter(item => item.id !== editingTrashId)
      );
      setExtraTrashes(current =>
        current.filter(item => item.id !== editingTrashId)
      );
      setSelectedTrash(null);
      setShowRouting(false);
      clearRoute();
      setIsDialogOpen(false);
      removeAdminPin();
      setEditingTrashId(null);
      setEditingTrashSource(null);
      setIsEditingTrash(false);

      Swal.fire({
        title: "Excluída!",
        text: "A lixeira foi removida com sucesso.",
        icon: "success",
        confirmButtonColor: "#22c55e",
        timer: 2000,
      });
    } catch (err: any) {
      console.error("Erro ao excluir lixeira:", err);
      Swal.fire({
        title: "Erro",
        text: err?.message || "Não foi possível excluir a lixeira.",
        icon: "error",
        confirmButtonColor: "#22c55e",
      });
    }
  };

  const handleTypeToggle = (type: WasteTypeOption) => {
    setSelectedTypes(prev =>
      prev.includes(type.nomeTipo)
        ? prev.filter(item => item !== type.nomeTipo)
        : [...prev, type.nomeTipo]
    );

    setSelectedTypeIds(prev =>
      prev.includes(type.id)
        ? prev.filter(item => item !== type.id)
        : [...prev, type.id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.address ||
      selectedTypes.length === 0 ||
      !formData.lat ||
      !formData.lng
    ) {
      Swal.fire({
        title: "Erro",
        text: "Preencha o endereço, a localização e selecione pelo menos um tipo.",
        icon: "error",
        confirmButtonColor: "#22c55e",
      });
      return;
    }

    try {
      if (isEditingTrash && editingTrashId) {
        await putLixeiras(editingTrashId, {
          latitude: Number(formData.lat),
          longitude: Number(formData.lng),
          informativosTiposIds: selectedTypeIds,
        });

        saveLixeiraTypes(editingTrashId, selectedTypes);

        setServerTrashes(current =>
          current.map(item =>
            item.id === editingTrashId
              ? {
                  ...item,
                  lat: Number(formData.lat),
                  lng: Number(formData.lng),
                  types: selectedTypes,
                  name:
                    selectedTypes.length > 0
                      ? `Lixeira ${selectedTypes.join(" / ")}`
                      : "Lixeira cadastrada",
                  address: formData.address as string,
                  beach: formData.address as string,
                }
              : item
          )
        );

        Swal.fire({
          title: "Sucesso!",
          text: "Lixeira atualizada com sucesso.",
          icon: "success",
          confirmButtonColor: "#22c55e",
          timer: 2000,
        });
      } else {
        const createdResponse = await postLixeiras({
          latitude: Number(formData.lat),
          longitude: Number(formData.lng),
          informativosTiposIds: selectedTypeIds,
        });

        const createdId = createdResponse?.data?.id;
        const createdKey =
          createdId != null ? String(createdId) : String(Date.now());
        saveLixeiraTypes(createdKey, selectedTypes);

        const saved: TrashLocation = {
          id: createdKey,
          lat: Number(formData.lat),
          lng: Number(formData.lng),
          name:
            selectedTypes.length > 0
              ? `Lixeira ${selectedTypes.join(" / ")}`
              : "Lixeira cadastrada",
          beach: formData.address as string,
          types: selectedTypes,
          address: formData.address as string,
          source: "backend",
        };

        setExtraTrashes(current => [...current, saved]);
        Swal.fire({
          title: "Sucesso!",
          text: "Lixeira cadastrada no backend.",
          icon: "success",
          confirmButtonColor: "#22c55e",
          timer: 2000,
        });
      }

      setFormData({ name: "", beach: "", address: "" });
      setSelectedTypes([]);
      setSelectedTypeIds([]);
      setIsEditingTrash(false);
      setEditingTrashId(null);
      setEditingTrashSource(null);
      setIsDialogOpen(false);
      removeAdminPin();
    } catch (err: any) {
      console.error("Erro ao salvar lixeira:", err);
      Swal.fire({
        title: "Erro",
        text: err?.message || "Não foi possível salvar a lixeira no backend.",
        icon: "error",
        confirmButtonColor: "#22c55e",
      });
    }
  };
  



  return (
    <div className="maps-page">
      <div className="maps-exit-container">
        <Button variant="ghost" onClick={() => navigate("/")}>
          Sair
        </Button>
      </div>
      {isLoading && (
        <div className="maps-loading-overlay">
          <Loader2 size={32} className="animate-spin" />
        </div>
      )}

      <MapView
        onMapReady={handleMapReady}
        style={{ width: "100vw", height: "100vh" }}
        className="maps-full"
      />

      {isAdmin_ && (
        <div className="maps-fab-container">
          <Button onClick={handleAddTrash} className="maps-fab" size="lg">
            <Plus size={24} />
            <span>Adicionar Lixeira</span>
          </Button>
        </div>
      )}


      {isAuthenticated_ && (
        <div
          className="maps-user-location"
          style={{ top: "30px", right: "20px", left: "auto", marginTop: "5vh" }}
        >
          <div
            className="maps-location-badge"
            style={{ backgroundColor: "#10b981", color: "white" }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "white",
              }}
            ></div>
            <span>Logado{isAdmin_ ? " (Admin)" : ""}</span>
          </div>
        </div>
      )}

      {userLocation && (
        <div className="maps-user-location">
          <div className="maps-location-badge">
            <MapPin size={16} />
            <span>
              {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
            </span>
          </div>
        </div>
      )}

      {selectedTrash && userLocation && (
        <div className="maps-trash-details-card">
          <div className="maps-card-header">
            <h3>{selectedTrash.name}</h3>
            <button
              className="maps-card-close-btn"
              onClick={() => {
                setSelectedTrash(null);
                setShowRouting(false);
                clearRoute();
              }}
            >
              <X size={20} />
            </button>
          </div>

          <div className="maps-card-location-row">
            <div className="maps-card-location-item">
              <span className="maps-card-location-label">De:</span>
              <span className="maps-card-location-value">Sua localização</span>
              <span className="maps-card-location-coords">
                {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
              </span>
            </div>
            <div className="maps-card-arrow">→</div>
            <div className="maps-card-location-item">
              <span className="maps-card-location-label">Para:</span>
              <span className="maps-card-location-value">
                {selectedTrash.name}
              </span>
              <span className="maps-card-location-coords">
                {selectedTrash.lat.toFixed(4)}, {selectedTrash.lng.toFixed(4)}
              </span>
            </div>
          </div>

          <div className="maps-card-info">
            <p className="maps-card-address">
              <strong>Endereço:</strong> {selectedTrash.address}
            </p>
           
          </div>

          <div className="maps-card-waste-section">
            <h4 className="maps-card-waste-title">Tipos de Resíduos Aceitos</h4>
            <div className="maps-card-types">
              {selectedTrash.types.map(type => {
                const option = wasteTypes.find(item => item.nomeTipo === type);
                return (
                  <span
                    key={type}
                    className="maps-card-type-badge"
                    style={{
                      background:
                        option?.cor ??
                        DEFAULT_WASTE_TYPE_COLORS[type] ??
                        "#64748b",
                    }}
                  >
                    {type}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="maps-card-transport-mode">
            <span className="maps-card-transport-label">
              Meio de transporte:
            </span>
            <div className="maps-card-transport-buttons">
              {TRANSPORT_MODES.map(mode => {
                const Icon = mode.icon;
                const active = mode.value === transportMode;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    className={`maps-transport-mode-btn ${active ? "active" : ""}`}
                    onClick={() => setTransportMode(mode.value)}
                  >
                    <span className="mode-icon">
                      <Icon size={16} />
                    </span>
                    <span className="mode-label">{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {showRouting && routeDistance && routeDuration && (
            <div className="maps-card-route-info">
              <p>
                <strong>Modo:</strong> A pé
              </p>
              <p>
                <strong>Distância:</strong> {routeDistance}
              </p>
              <p>
                <strong>Tempo estimado:</strong> {routeDuration}
              </p>
            </div>
          )}

          <div
            className="maps-card-actions"
            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
          >
            {!showRouting ? (
              <Button
                onClick={() => setShowRouting(true)}
                className="maps-card-route-btn"
                disabled={isRoutingLoading}
              >
                {isRoutingLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Traçando...
                  </>
                ) : (
                  <>
                    <Navigation size={16} />
                    Traçar Rota
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => setShowRouting(false)}
                variant="outline"
                className="maps-card-clear-btn"
              >
                <X size={16} />
                Limpar Rota
              </Button>
            )}
            {isAdmin_ && (
              <Button
                variant="outline"
                onClick={() => handleEditTrash(selectedTrash)}
              >
                Editar Lixeira
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={isDialogOpen}
        onOpenChange={open => {
          setIsDialogOpen(open);
          if (!open) {
            removeAdminPin();
            setEditingTrashSource(null);
          }
        }}
      >
        <DialogContent className="maps-dialog">
          <DialogHeader>
            <DialogTitle>
              {isEditingTrash ? "Editar Lixeira" : "Registrar Nova Lixeira"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="maps-form">
            <div className="maps-form-group">
              <Label htmlFor="address">Endereço</Label>
              <Input
                id="address"
                placeholder={
                  isGeocodingAddress
                    ? "Buscando endereço..."
                    : "Ex: Avenida Beira Mar, 1000"
                }
                value={formData.address || ""}
                disabled={isGeocodingAddress}
                onChange={e =>
                  setFormData({ ...formData, address: e.target.value })
                }
              />
              {isGeocodingAddress && (
                <p className="maps-type-helper">
                  Preenchendo automaticamente com base na sua localização...
                </p>
              )}
            </div>

            <div className="maps-form-group">
              <Label>Tipos de Resíduos Aceitos</Label>
              <p className="maps-type-helper">
                Selecione um ou mais tipos que a lixeira aceita.
              </p>
              <div className="maps-type-checkbox-grid">
                {wasteTypes.map(type => {
                  const checked = selectedTypes.includes(type.nomeTipo);
                  return (
                    <label
                      key={type.id}
                      className={`maps-type-checkbox-card ${checked ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleTypeToggle(type)}
                      />
                      <span className="maps-type-checkbox-content">
                        <span
                          className="maps-type-checkbox-dot"
                          style={{ backgroundColor: type.cor }}
                        />
                        <span className="maps-type-checkbox-label">
                          {type.nomeTipo}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="maps-form-group">
              <Label>Localização</Label>
              <p className="maps-type-helper">
                Um marcador laranja apareceu no mapa. Arraste-o até o ponto
                exato da lixeira — o endereço acima é atualizado
                automaticamente.
              </p>
              <div className="maps-location-display">
                <p>Latitude: {(formData.lat || 0).toFixed(6)}</p>
                <p>Longitude: {(formData.lng || 0).toFixed(6)}</p>
              </div>
            </div>

            <div
              className="maps-form-actions"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    removeAdminPin();
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit">
                  {isEditingTrash ? "Salvar Alterações" : "Registrar Lixeira"}
                </Button>
              </div>

              {isEditingTrash && editingTrashSource === "backend" && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteTrash}
                >
                  Excluir Lixeira
                </Button>
              )}
              {isEditingTrash && editingTrashSource === "static" && (
                <p className="maps-type-helper" style={{ margin: 0 }}>
                  Lixeira de demonstração — exclusão indisponível.
                </p>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {isRoutingLoading && (
        <div className="maps-routing-loading">
          <Loader2 size={20} className="animate-spin" />
          <span>Traçando rota...</span>
        </div>
      )}
    </div>
  );
}