"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  HardHat,
  ListChecks,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

import {
  actionCatalog,
  classifyRisk,
  condoCatalog,
  environmentAreas,
  getRisk,
  getRole,
  getSuggestedScenarios,
  gheCatalog,
  roleCatalog,
  scenarioCatalog,
  type Probability,
  type ScenarioId,
  type Severity,
} from "./pgr-data";
import { getIncludedActions, getSelectedRoles } from "./pgr-selectors";
import {
  buildNr01Report,
  matchNr01Location,
  parseNr01Csv,
  type Nr01Dataset,
} from "./nr01";
import type { PgrState } from "./pgr-types";

const STORAGE_PREFIX = "dinamizza-pgr-v1:";
const LAST_CONDO_KEY = "dinamizza-pgr-v1:last-condo";
const NR01_DATA_KEY = "dinamizza-pgr-v1:nr01-dataset";
const NR01_SETTINGS_KEY = "dinamizza-pgr-v1:nr01-settings";

type Nr01Settings = {
  locationByCondo: Record<string, string>;
  includeByCondo: Record<string, boolean>;
};

const emptyNr01Settings: Nr01Settings = { locationByCondo: {}, includeByCondo: {} };

const steps = [
  { id: 0, label: "Identificação", short: "Dados", icon: Building2 },
  { id: 1, label: "Quadro de funcionários", short: "Quadro", icon: Users },
  { id: 2, label: "Atividades e exposições", short: "Atividades", icon: ListChecks },
  { id: 3, label: "Inventário de riscos", short: "Riscos", icon: ShieldCheck },
  { id: 4, label: "Relatório NR-01", short: "NR-01", icon: BarChart3 },
  { id: 5, label: "Plano e exportação", short: "Exportar", icon: FileCheck2 },
] as const;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function suggestedAreasForRoles(roleIds: string[]) {
  const ghes = new Set(roleIds.map((id) => getRole(id)?.ghe));
  const areas = new Set<string>(["Halls e corredores", "Escadas e rampas"]);
  if (ghes.has("GHE 01")) areas.add("Áreas administrativas");
  if (ghes.has("GHE 02")) {
    areas.add("Sanitários");
    areas.add("Áreas externas");
  }
  if (ghes.has("GHE 03") || ghes.has("GHE 05")) areas.add("Portaria e acessos");
  if (ghes.has("GHE 04") || ghes.has("GHE 06")) {
    areas.add("Áreas técnicas");
    areas.add("Locais de manutenção");
  }
  if (ghes.has("GHE 06")) areas.add("Depósitos e almoxarifados");
  if (ghes.has("GHE 07")) areas.add("Garagens");
  return [...areas];
}

function createStateForCondo(condoId: string): PgrState {
  const condo = condoCatalog.find((item) => item.id === condoId) ?? condoCatalog[0];
  const roles = Object.fromEntries(
    roleCatalog.map((role) => [
      role.id,
      {
        selected: condo.suggestedRoleIds.includes(role.id),
        quantity: condo.fixedCounts?.[role.id] ?? 0,
      },
    ]),
  );
  return {
    condoId: condo.id,
    condoName: condo.id === "personalizado" ? "" : condo.name,
    expectedTotal: condo.expectedTotal,
    cnpj: condo.cnpj ?? "",
    address: "",
    cityState: "",
    contractingCompany: "GRUPO DINAMIZZA",
    localResponsible: "",
    issueDate: todayIso(),
    reviewDate: "",
    technicalResponsible: "",
    professionalTitle: "",
    professionalRegistration: "",
    environmentDescription:
      "Condomínio ou edificação pronta e em funcionamento, com ambientes a confirmar em visita técnica quanto a ventilação, iluminação, circulação, pisos, acessos, sinalização, rotas de fuga, equipamentos de emergência e instalações elétricas.",
    selectedAreas: suggestedAreasForRoles(condo.suggestedRoleIds),
    notes: condo.note ?? "",
    roles,
    scenarios: getSuggestedScenarios(condo.suggestedRoleIds),
    riskOverrides: {},
    riskAssessments: {},
    actions: {},
  };
}

function loadState(condoId: string) {
  if (typeof window === "undefined") return createStateForCondo(condoId);
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${condoId}`);
    if (!stored) return createStateForCondo(condoId);
    const parsed = JSON.parse(stored) as PgrState;
    const fresh = createStateForCondo(condoId);
    return {
      ...fresh,
      ...parsed,
      cnpj: parsed.cnpj || fresh.cnpj,
      roles: { ...fresh.roles, ...parsed.roles },
      scenarios: { ...fresh.scenarios, ...parsed.scenarios },
      riskOverrides: parsed.riskOverrides ?? {},
      riskAssessments: parsed.riskAssessments ?? {},
      actions: parsed.actions ?? {},
    };
  } catch {
    return createStateForCondo(condoId);
  }
}

function FieldLabel({ htmlFor, children, optional }: { htmlFor?: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="field-label">
      <span>{children}</span>
      {optional && <span className="field-optional">opcional</span>}
    </label>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "neutral" | "high"; children: React.ReactNode }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<PgrState>(() => createStateForCondo(condoCatalog[0].id));
  const [roleSearch, setRoleSearch] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [nr01Dataset, setNr01Dataset] = useState<Nr01Dataset | null>(null);
  const [nr01Settings, setNr01Settings] = useState<Nr01Settings>(emptyNr01Settings);
  const stateRef = useRef(state);
  const nr01DatasetRef = useRef<Nr01Dataset | null>(null);
  const nr01SettingsRef = useRef<Nr01Settings>(emptyNr01Settings);
  const nr01FileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const lastCondo = window.localStorage.getItem(LAST_CONDO_KEY);
    setState(loadState(lastCondo && condoCatalog.some((condo) => condo.id === lastCondo) ? lastCondo : condoCatalog[0].id));
    try {
      const storedDataset = window.localStorage.getItem(NR01_DATA_KEY);
      const storedSettings = window.localStorage.getItem(NR01_SETTINGS_KEY);
      if (storedDataset) setNr01Dataset(JSON.parse(storedDataset) as Nr01Dataset);
      if (storedSettings) setNr01Settings({ ...emptyNr01Settings, ...(JSON.parse(storedSettings) as Nr01Settings) });
    } catch {
      window.localStorage.removeItem(NR01_DATA_KEY);
      window.localStorage.removeItem(NR01_SETTINGS_KEY);
    }
  }, []);

  useEffect(() => {
    stateRef.current = state;
    window.localStorage.setItem(`${STORAGE_PREFIX}${state.condoId}`, JSON.stringify(state));
    window.localStorage.setItem(LAST_CONDO_KEY, state.condoId);
  }, [state]);

  useEffect(() => {
    nr01DatasetRef.current = nr01Dataset;
    if (nr01Dataset) window.localStorage.setItem(NR01_DATA_KEY, JSON.stringify(nr01Dataset));
    else window.localStorage.removeItem(NR01_DATA_KEY);
  }, [nr01Dataset]);

  useEffect(() => {
    nr01SettingsRef.current = nr01Settings;
    window.localStorage.setItem(NR01_SETTINGS_KEY, JSON.stringify(nr01Settings));
  }, [nr01Settings]);

  useEffect(() => {
    setIsOnline(window.navigator.onLine);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", captureInstall);
    };
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext["registerTool"]>[0]) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
      } catch {
        // WebMCP is optional and feature-detected.
      }
    };

    register({
      name: "get_pgr_summary",
      title: "Consultar resumo do PGR",
      description: "Retorna o condomínio atual, cargos, total de trabalhadores e conferência com a referência.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => {
        const current = stateRef.current;
        const roles = getSelectedRoles(current);
        const total = roles.reduce((sum, role) => sum + role.quantity, 0);
        return {
          condominium: current.condoName,
          workers: total,
          roles: roles.map((role) => ({ name: role.name, quantity: role.quantity, ghe: role.ghe })),
          expectedWorkers: current.expectedTotal,
          totalMatchesReference: current.expectedTotal === null || current.expectedTotal === total,
        };
      },
    });

    register({
      name: "select_condominium",
      title: "Selecionar condomínio",
      description: "Abre ou inicia a configuração de um condomínio cadastrado.",
      inputSchema: {
        type: "object",
        properties: { condoId: { type: "string", enum: condoCatalog.map((condo) => condo.id) } },
        required: ["condoId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        const condoId = (input as { condoId?: string }).condoId;
        const condo = condoCatalog.find((item) => item.id === condoId);
        if (!condo) throw new Error("Condomínio não encontrado.");
        const next = loadState(condo.id);
        stateRef.current = next;
        setState(next);
        setStep(0);
        return { condoId: condo.id, condominium: next.condoName || condo.name, status: "selected" };
      },
    });

    register({
      name: "configure_staffing",
      title: "Configurar quadro de funcionários",
      description: "Substitui o quadro atual por uma lista validada de cargos e quantidades.",
      inputSchema: {
        type: "object",
        properties: {
          roles: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                roleId: { type: "string", enum: roleCatalog.map((role) => role.id) },
                quantity: { type: "integer", minimum: 0, maximum: 999 },
              },
              required: ["roleId", "quantity"],
              additionalProperties: false,
            },
          },
        },
        required: ["roles"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        const items = (input as { roles?: Array<{ roleId?: string; quantity?: number }> }).roles;
        if (!Array.isArray(items) || !items.length) throw new Error("Informe ao menos um cargo.");
        const seen = new Set<string>();
        for (const item of items) {
          if (!item.roleId || !getRole(item.roleId) || !Number.isInteger(item.quantity) || (item.quantity ?? -1) < 0) throw new Error("Cargo ou quantidade inválida.");
          if (seen.has(item.roleId)) throw new Error("Cargo duplicado.");
          seen.add(item.roleId);
        }
        const current = stateRef.current;
        const roles = Object.fromEntries(
          roleCatalog.map((role) => {
            const item = items.find((entry) => entry.roleId === role.id);
            return [role.id, { selected: Boolean(item && (item.quantity ?? 0) > 0), quantity: item?.quantity ?? 0 }];
          }),
        );
        const selectedIds = items.filter((item) => (item.quantity ?? 0) > 0).map((item) => item.roleId as string);
        const next = { ...current, roles, scenarios: { ...current.scenarios, ...getSuggestedScenarios(selectedIds) } };
        stateRef.current = next;
        setState(next);
        setStep(1);
        return { workers: items.reduce((sum, item) => sum + (item.quantity ?? 0), 0), configuredRoles: selectedIds.length };
      },
    });

    register({
      name: "export_pgr_docx",
      title: "Gerar PGR em Word",
      description: "Gera e baixa o arquivo DOCX do condomínio atualmente configurado.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async () => {
        const current = stateRef.current;
        if (!getSelectedRoles(current).length) throw new Error("O quadro de funcionários está vazio.");
        const dataset = nr01DatasetRef.current;
        const settings = nr01SettingsRef.current;
        const configuredLocation = settings.locationByCondo[current.condoId];
        const location = dataset?.locations.includes(configuredLocation)
          ? configuredLocation
          : matchNr01Location(dataset, current.condoName, current.cnpj);
        const workerCount = getSelectedRoles(current).reduce((sum, role) => sum + role.quantity, 0);
        const report = buildNr01Report(dataset, location, workerCount || current.expectedTotal);
        const includeNr01 = settings.includeByCondo[current.condoId] ?? true;
        const { downloadPgrDocx } = await import("./docx-generator");
        await downloadPgrDocx(current, includeNr01 ? report ?? undefined : undefined);
        return { status: "download_started", condominium: current.condoName, nr01Included: Boolean(includeNr01 && report) };
      },
    });

    return () => lifecycle.abort();
  }, []);

  const currentCondo = condoCatalog.find((condo) => condo.id === state.condoId) ?? condoCatalog[0];
  const selectedRoles = useMemo(() => getSelectedRoles(state), [state]);
  const totalWorkers = selectedRoles.reduce((sum, role) => sum + role.quantity, 0);
  const selectedGheCount = new Set(selectedRoles.map((role) => role.ghe)).size;
  const selectedScenarioCount = scenarioCatalog.filter((scenario) => state.scenarios[scenario.id]).length;
  const includedActions = useMemo(() => getIncludedActions(state), [state]);
  const includedRiskCount = useMemo(
    () => selectedRoles.reduce(
      (total, role) => total + role.riskIds.filter((riskId) => {
        const risk = getRisk(riskId);
        if (!risk) return false;
        const override = state.riskOverrides[`${role.id}:${riskId}`];
        return typeof override === "boolean" ? override : !risk.condition || state.scenarios[risk.condition];
      }).length,
      0,
    ),
    [selectedRoles, state.riskOverrides, state.scenarios],
  );
  const automaticNr01Location = useMemo(
    () => matchNr01Location(nr01Dataset, state.condoName, state.cnpj),
    [nr01Dataset, state.condoName, state.cnpj],
  );
  const configuredNr01Location = nr01Settings.locationByCondo[state.condoId];
  const selectedNr01Location = nr01Dataset?.locations.includes(configuredNr01Location)
    ? configuredNr01Location
    : automaticNr01Location;
  const nr01Report = useMemo(
    () => buildNr01Report(nr01Dataset, selectedNr01Location, totalWorkers || state.expectedTotal),
    [nr01Dataset, selectedNr01Location, state.expectedTotal, totalWorkers],
  );
  const includeNr01 = nr01Settings.includeByCondo[state.condoId] ?? true;

  const warnings = useMemo(() => {
    const items: string[] = [];
    if (!state.condoName.trim()) items.push("Informe o nome do condomínio.");
    if (!state.cnpj.trim()) items.push("CNPJ ainda não informado.");
    if (!state.address.trim() || !state.cityState.trim()) items.push("Complete o endereço do estabelecimento.");
    if (!selectedRoles.length) items.push("Inclua ao menos um cargo com quantidade.");
    if (state.expectedTotal !== null && totalWorkers !== state.expectedTotal) items.push(`O quadro soma ${totalWorkers}, mas a referência indica ${state.expectedTotal}.`);
    if (!state.technicalResponsible.trim()) items.push("Responsável técnico ainda não informado.");
    if (nr01Dataset && !selectedNr01Location) items.push("Selecione o local correspondente no CSV da NR-01.");
    if (includeNr01 && nr01Report && !nr01Report.canPublishDetailedResults) items.push("A NR-01 tem menos de 3 respostas; os resultados detalhados serão suprimidos por sigilo.");
    return items;
  }, [includeNr01, nr01Dataset, nr01Report, selectedNr01Location, selectedRoles.length, state, totalWorkers]);

  const completedChecks = [
    Boolean(state.condoName.trim()),
    Boolean(state.address.trim() && state.cityState.trim()),
    selectedRoles.length > 0,
    state.expectedTotal === null || totalWorkers === state.expectedTotal,
    state.selectedAreas.length > 0,
    selectedScenarioCount > 0,
    includedRiskCount > 0,
    Boolean(state.technicalResponsible.trim()),
  ].filter(Boolean).length;
  const readiness = Math.round((completedChecks / 8) * 100);

  const filteredRoleGroups = useMemo(() => {
    const query = roleSearch.trim().toLocaleLowerCase("pt-BR");
    return gheCatalog.map((ghe) => ({
      ...ghe,
      roles: roleCatalog.filter((role) => role.ghe === ghe.id && (!query || role.name.toLocaleLowerCase("pt-BR").includes(query))),
    })).filter((ghe) => ghe.roles.length);
  }, [roleSearch]);

  const update = <K extends keyof PgrState>(key: K, value: PgrState[K]) => setState((current) => ({ ...current, [key]: value }));

  const selectCondo = (condoId: string) => {
    setState(loadState(condoId));
    setStep(0);
    setRoleSearch("");
    const condo = condoCatalog.find((item) => item.id === condoId);
    toast.info(condoId === "personalizado" ? "Nova configuração iniciada" : `Configuração aberta: ${condo?.name}`);
  };

  const updateRole = (roleId: string, patch: Partial<{ selected: boolean; quantity: number }>) => {
    setState((current) => {
      const currentRole = current.roles[roleId] ?? { selected: false, quantity: 0 };
      const nextRole = { ...currentRole, ...patch };
      if (patch.selected === true && nextRole.quantity === 0) nextRole.quantity = 1;
      if (patch.quantity !== undefined) {
        nextRole.quantity = Math.max(0, Math.min(999, Math.trunc(Number(patch.quantity) || 0)));
        nextRole.selected = nextRole.quantity > 0 || currentRole.selected;
      }
      return { ...current, roles: { ...current.roles, [roleId]: nextRole } };
    });
  };

  const toggleArea = (area: string, checked: boolean) => update("selectedAreas", checked ? [...new Set([...state.selectedAreas, area])] : state.selectedAreas.filter((item) => item !== area));
  const toggleScenario = (scenarioId: ScenarioId, checked: boolean) => setState((current) => ({ ...current, scenarios: { ...current.scenarios, [scenarioId]: checked } }));
  const toggleRisk = (roleId: string, riskId: string, checked: boolean) => setState((current) => ({ ...current, riskOverrides: { ...current.riskOverrides, [`${roleId}:${riskId}`]: checked } }));

  const updateRiskAssessment = (roleId: string, riskId: string, patch: Partial<{ severity: Severity; probability: Probability }>) => {
    const risk = getRisk(riskId);
    if (!risk) return;
    const key = `${roleId}:${riskId}`;
    setState((current) => ({
      ...current,
      riskAssessments: {
        ...current.riskAssessments,
        [key]: {
          severity: current.riskAssessments[key]?.severity ?? risk.severity,
          probability: current.riskAssessments[key]?.probability ?? risk.probability,
          ...patch,
        },
      },
    }));
  };

  const toggleAction = (actionId: string, included: boolean) => {
    const action = actionCatalog.find((item) => item.id === actionId);
    if (!action) return;
    setState((current) => ({
      ...current,
      actions: { ...current.actions, [actionId]: { included, deadline: current.actions[actionId]?.deadline ?? action.deadline, responsible: current.actions[actionId]?.responsible ?? action.responsible } },
    }));
  };

  const updateAction = (actionId: string, patch: Partial<{ deadline: string; responsible: string }>) => {
    const action = actionCatalog.find((item) => item.id === actionId);
    if (!action) return;
    const defaultIncluded = !action.condition || state.scenarios[action.condition];
    setState((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [actionId]: {
          included: current.actions[actionId]?.included ?? defaultIncluded,
          deadline: current.actions[actionId]?.deadline ?? action.deadline,
          responsible: current.actions[actionId]?.responsible ?? action.responsible,
          ...patch,
        },
      },
    }));
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") toast.success("Aplicativo instalado");
    setInstallPrompt(null);
  };

  const handleNr01File = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".csv")) {
      toast.error("Selecione um arquivo CSV exportado do Google Forms.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("O CSV excede o limite de 10 MB.");
      return;
    }
    try {
      const dataset = parseNr01Csv(await file.text(), file.name);
      const matchedLocation = matchNr01Location(dataset, state.condoName, state.cnpj);
      setNr01Dataset(dataset);
      setNr01Settings((current) => ({
        locationByCondo: matchedLocation
          ? { ...current.locationByCondo, [state.condoId]: matchedLocation }
          : current.locationByCondo,
        includeByCondo: { ...current.includeByCondo, [state.condoId]: true },
      }));
      toast.success(`${dataset.responses.length} respostas válidas importadas de ${dataset.locations.length} local(is).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o CSV da NR-01.");
    }
  };

  const selectNr01Location = (location: string) => {
    setNr01Settings((current) => ({
      ...current,
      locationByCondo: { ...current.locationByCondo, [state.condoId]: location },
    }));
  };

  const setNr01Included = (included: boolean) => {
    setNr01Settings((current) => ({
      ...current,
      includeByCondo: { ...current.includeByCondo, [state.condoId]: included },
    }));
  };

  const clearNr01Dataset = () => {
    setNr01Dataset(null);
    setNr01Settings(emptyNr01Settings);
    toast.info("Dados importados da NR-01 removidos deste dispositivo.");
  };

  const handleGenerate = async () => {
    if (!state.condoName.trim()) {
      setStep(0);
      toast.error("Informe o nome do condomínio antes de gerar o PGR.");
      return;
    }
    if (!selectedRoles.length) {
      setStep(1);
      toast.error("Inclua ao menos um cargo com quantidade superior a zero.");
      return;
    }
    setIsGenerating(true);
    try {
      const { downloadPgrDocx } = await import("./docx-generator");
      await downloadPgrDocx(state, includeNr01 ? nr01Report ?? undefined : undefined);
      toast.success(includeNr01 && nr01Report ? "PGR com relatório NR-01 gerado com sucesso" : "Arquivo Word gerado com sucesso");
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível gerar o Word. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const renderIdentification = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div>
          <span className="eyebrow">Etapa 1 de 6</span>
          <h1>Identificação do estabelecimento</h1>
          <p>Selecione o cadastro-base e complete os dados que aparecerão na capa e no escopo do PGR.</p>
        </div>
        <div className="source-chip"><FileText aria-hidden="true" /><span>Modelo-base carregado</span></div>
      </section>

      <section className="section-card featured-card">
        <div className="field-grid field-grid-2">
          <div className="field-span-2">
            <FieldLabel>Condomínio ou estabelecimento</FieldLabel>
            <Select value={state.condoId} onValueChange={selectCondo}>
              <SelectTrigger className="select-large"><SelectValue placeholder="Selecione o condomínio" /></SelectTrigger>
              <SelectContent position="popper" className="max-w-[min(92vw,620px)]">
                {condoCatalog.map((condo) => <SelectItem key={condo.id} value={condo.id}>{condo.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="field-span-2">
            <FieldLabel htmlFor="condo-name">Nome que aparecerá no documento</FieldLabel>
            <Input id="condo-name" value={state.condoName} onChange={(event) => update("condoName", event.target.value)} placeholder="Nome completo do estabelecimento" />
          </div>
          <div>
            <FieldLabel htmlFor="cnpj">CNPJ</FieldLabel>
            <Input id="cnpj" value={state.cnpj} onChange={(event) => update("cnpj", event.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" />
          </div>
          <div>
            <FieldLabel htmlFor="expected-total">Total de referência</FieldLabel>
            <Input id="expected-total" type="number" min={0} value={state.expectedTotal ?? ""} onChange={(event) => update("expectedTotal", event.target.value === "" ? null : Math.max(0, Number(event.target.value)))} placeholder="Não informado" />
          </div>
          <div className="field-span-2">
            <FieldLabel htmlFor="address">Endereço</FieldLabel>
            <Input id="address" value={state.address} onChange={(event) => update("address", event.target.value)} placeholder="Rua, número, bairro" />
          </div>
          <div>
            <FieldLabel htmlFor="city-state">Cidade e UF</FieldLabel>
            <Input id="city-state" value={state.cityState} onChange={(event) => update("cityState", event.target.value)} placeholder="Cidade – UF" />
          </div>
          <div>
            <FieldLabel htmlFor="local-responsible">Responsável local</FieldLabel>
            <Input id="local-responsible" value={state.localResponsible} onChange={(event) => update("localResponsible", event.target.value)} placeholder="Nome do síndico ou gestor" />
          </div>
          <div>
            <FieldLabel htmlFor="provider">Empresa prestadora</FieldLabel>
            <Input id="provider" value={state.contractingCompany} onChange={(event) => update("contractingCompany", event.target.value)} />
          </div>
          <div className="date-row">
            <div><FieldLabel htmlFor="issue-date">Data de emissão</FieldLabel><Input id="issue-date" type="date" value={state.issueDate} onChange={(event) => update("issueDate", event.target.value)} /></div>
            <div><FieldLabel htmlFor="review-date" optional>Revisão prevista</FieldLabel><Input id="review-date" type="date" value={state.reviewDate} onChange={(event) => update("reviewDate", event.target.value)} /></div>
          </div>
        </div>
        {currentCondo.note && <div className="notice notice-amber"><AlertTriangle aria-hidden="true" /><div><strong>Atenção à base cadastral</strong><p>{currentCondo.note}</p></div></div>}
      </section>

      <section className="section-card">
        <div className="section-heading"><div><span className="eyebrow">Assinatura técnica</span><h2>Responsável pelo documento</h2></div></div>
        <div className="field-grid field-grid-3">
          <div><FieldLabel htmlFor="technical-name">Nome</FieldLabel><Input id="technical-name" value={state.technicalResponsible} onChange={(event) => update("technicalResponsible", event.target.value)} placeholder="Responsável técnico" /></div>
          <div><FieldLabel htmlFor="technical-title">Função ou título</FieldLabel><Input id="technical-title" value={state.professionalTitle} onChange={(event) => update("professionalTitle", event.target.value)} placeholder="Ex.: Engenheiro de Segurança" /></div>
          <div><FieldLabel htmlFor="technical-registration">Registro profissional</FieldLabel><Input id="technical-registration" value={state.professionalRegistration} onChange={(event) => update("professionalRegistration", event.target.value)} placeholder="CREA, CRM ou outro" /></div>
        </div>
      </section>
    </div>
  );

  const renderStaffing = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div><span className="eyebrow">Etapa 2 de 6</span><h1>Quadro de funcionários</h1><p>Marque os cargos existentes e informe a quantidade real em cada função.</p></div>
        <div className="metric-strip" aria-label="Resumo do quadro">
          <div><span>Configurado</span><strong>{totalWorkers}</strong></div>
          <div><span>Referência</span><strong>{state.expectedTotal ?? "—"}</strong></div>
          <div><span>Diferença</span><strong className={state.expectedTotal !== null && totalWorkers !== state.expectedTotal ? "metric-warn" : ""}>{state.expectedTotal === null ? "—" : totalWorkers - state.expectedTotal}</strong></div>
        </div>
      </section>
      <section className="section-card">
        <div className="toolbar-row">
          <div className="search-box"><Search aria-hidden="true" /><Input value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder="Buscar cargo" aria-label="Buscar cargo" /></div>
          <StatusPill tone={state.expectedTotal === null || totalWorkers === state.expectedTotal ? "ok" : "warn"}>{state.expectedTotal === null || totalWorkers === state.expectedTotal ? "Total conferido" : "Quantidade divergente"}</StatusPill>
        </div>
        <div className="role-groups">
          {filteredRoleGroups.map((ghe) => (
            <div className="role-group" key={ghe.id}>
              <div className="role-group-title"><span>{ghe.id}</span><h2>{ghe.name}</h2><small>{ghe.roles.filter((role) => state.roles[role.id]?.selected).length} selecionado(s)</small></div>
              <div className="role-list">
                {ghe.roles.map((role) => {
                  const selection = state.roles[role.id];
                  const suggested = currentCondo.suggestedRoleIds.includes(role.id);
                  return (
                    <div className={`role-row ${selection?.selected ? "role-selected" : ""}`} key={role.id}>
                      <Checkbox id={`role-${role.id}`} checked={selection?.selected ?? false} onCheckedChange={(checked) => updateRole(role.id, { selected: checked === true })} aria-label={`Incluir ${role.name}`} />
                      <label htmlFor={`role-${role.id}`} className="role-name"><strong>{role.name}</strong><span>{suggested ? "Indicado na referência" : role.gheName}</span></label>
                      <div className="quantity-control" aria-label={`Quantidade de ${role.name}`}>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => updateRole(role.id, { quantity: Math.max(0, (selection?.quantity ?? 0) - 1) })} disabled={!selection?.selected || (selection?.quantity ?? 0) === 0} aria-label="Diminuir quantidade"><Minus /></Button>
                        <Input type="number" min={0} max={999} value={selection?.quantity ?? 0} onChange={(event) => updateRole(role.id, { quantity: Number(event.target.value) })} disabled={!selection?.selected} aria-label={`Quantidade de ${role.name}`} />
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => updateRole(role.id, { quantity: (selection?.quantity ?? 0) + 1 })} disabled={!selection?.selected} aria-label="Aumentar quantidade"><Plus /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderActivities = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div><span className="eyebrow">Etapa 3 de 6</span><h1>Atividades e exposições</h1><p>Marque somente o que ocorre na rotina. As escolhas controlam riscos, treinamentos, inspeções e capítulos do Word.</p></div>
        <StatusPill tone="neutral">{selectedScenarioCount} condições incluídas</StatusPill>
      </section>
      <section className="section-card">
        <div className="section-heading"><div><span className="eyebrow">Ambientes</span><h2>Áreas abrangidas pelo trabalho</h2></div></div>
        <div className="check-grid">
          {environmentAreas.map((area) => <label key={area} className={`check-tile ${state.selectedAreas.includes(area) ? "check-tile-selected" : ""}`}><Checkbox checked={state.selectedAreas.includes(area)} onCheckedChange={(checked) => toggleArea(area, checked === true)} /><span>{area}</span></label>)}
        </div>
        <div className="field-block"><FieldLabel htmlFor="environment-description">Caracterização do ambiente</FieldLabel><Textarea id="environment-description" rows={4} value={state.environmentDescription} onChange={(event) => update("environmentDescription", event.target.value)} /></div>
      </section>
      <section className="section-card">
        <div className="section-heading"><div><span className="eyebrow">Checklist técnico</span><h2>Condições existentes</h2></div><p>Cada item pode adicionar riscos e requisitos ao documento.</p></div>
        <div className="scenario-grid">
          {scenarioCatalog.map((scenario) => {
            const checked = state.scenarios[scenario.id];
            const highAttention = scenario.id === "eletricidade" || scenario.id === "trabalhoAltura" || scenario.id === "segurancaPatrimonial";
            return (
              <label key={scenario.id} className={`scenario-card ${checked ? "scenario-selected" : ""}`}>
                <div className="scenario-top"><Checkbox checked={checked} onCheckedChange={(value) => toggleScenario(scenario.id, value === true)} /><span className="scenario-label">{scenario.label}</span>{highAttention && <StatusPill tone="high">atenção</StatusPill>}</div>
                <p>{scenario.description}</p><span className="scenario-impact">Inclui: {scenario.section}</span>
              </label>
            );
          })}
        </div>
      </section>
      <section className="section-card"><FieldLabel htmlFor="technical-notes" optional>Observações da visita e validações pendentes</FieldLabel><Textarea id="technical-notes" rows={5} value={state.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Registre divergências, limitações, tarefas eventuais e pontos que precisam ser confirmados." /></section>
    </div>
  );

  const renderInventory = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div><span className="eyebrow">Etapa 4 de 6</span><h1>Inventário de riscos</h1><p>Revise os riscos sugeridos para cada cargo e ajuste severidade e probabilidade quando o reconhecimento técnico justificar.</p></div>
        <div className="metric-strip compact"><div><span>Funções</span><strong>{selectedRoles.length}</strong></div><div><span>Riscos</span><strong>{includedRiskCount}</strong></div><div><span>GHEs</span><strong>{selectedGheCount}</strong></div></div>
      </section>
      {!selectedRoles.length ? (
        <section className="empty-state section-card"><Users aria-hidden="true" /><h2>O quadro ainda está vazio</h2><p>Volte à etapa anterior e informe ao menos um cargo com quantidade superior a zero.</p><Button onClick={() => setStep(1)}><ArrowLeft /> Voltar ao quadro</Button></section>
      ) : (
        <section className="risk-stack">
          {selectedRoles.map((role, index) => {
            const visibleRisks = role.riskIds.map(getRisk).filter(Boolean);
            return (
              <details className="risk-role-card" key={role.id} open={index === 0}>
                <summary><div className="risk-summary-icon"><HardHat /></div><div><strong>{role.name}</strong><span>{role.quantity} trabalhador(es) · {role.ghe} · {role.gheName}</span></div><StatusPill tone="neutral">{visibleRisks.length} sugestões</StatusPill><ChevronDown className="details-chevron" /></summary>
                <div className="risk-role-content">
                  <p className="role-description">{role.description}</p>
                  <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>Incluir</th><th>Risco e fonte</th><th>Severidade</th><th>Probabilidade</th><th>Nível</th></tr></thead><tbody>
                    {visibleRisks.map((riskMaybe) => {
                      if (!riskMaybe) return null;
                      const risk = riskMaybe;
                      const key = `${role.id}:${risk.id}`;
                      const defaultIncluded = !risk.condition || state.scenarios[risk.condition];
                      const included = typeof state.riskOverrides[key] === "boolean" ? state.riskOverrides[key] : defaultIncluded;
                      const assessment = state.riskAssessments[key] ?? { severity: risk.severity, probability: risk.probability };
                      const score = assessment.severity * assessment.probability;
                      const classification = classifyRisk(score);
                      return (
                        <tr key={risk.id} className={!included ? "risk-disabled" : ""}>
                          <td><Checkbox checked={included} onCheckedChange={(checked) => toggleRisk(role.id, risk.id, checked === true)} aria-label={`Incluir risco ${risk.type}`} /></td>
                          <td><strong>{risk.type}</strong><span>{risk.source}</span><small>{risk.damages}</small></td>
                          <td><Select value={String(assessment.severity)} onValueChange={(value) => updateRiskAssessment(role.id, risk.id, { severity: Number(value) as Severity })} disabled={!included}><SelectTrigger className="risk-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 · Irrelevante</SelectItem><SelectItem value="3">3 · Marginal</SelectItem><SelectItem value="6">6 · Crítica</SelectItem><SelectItem value="9">9 · Catastrófica</SelectItem></SelectContent></Select></td>
                          <td><Select value={String(assessment.probability)} onValueChange={(value) => updateRiskAssessment(role.id, risk.id, { probability: Number(value) as Probability })} disabled={!included}><SelectTrigger className="risk-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">0 · Impossível</SelectItem><SelectItem value="1">1 · Raro</SelectItem><SelectItem value="2">2 · Incomum</SelectItem><SelectItem value="4">4 · Ocasional</SelectItem><SelectItem value="6">6 · Frequente</SelectItem><SelectItem value="8">8 · Contínuo</SelectItem></SelectContent></Select></td>
                          <td><StatusPill tone={classification === "Alto" ? "high" : classification === "Médio" ? "warn" : "ok"}>{score} · {classification}</StatusPill></td>
                        </tr>
                      );
                    })}
                  </tbody></table></div>
                </div>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );

  const renderNr01 = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div><span className="eyebrow">Etapa 5 de 6</span><h1>Relatório psicossocial da NR-01</h1><p>Importe o CSV do Google Forms, confirme o local e revise os indicadores que serão anexados ao PGR.</p></div>
        {nr01Report ? (
          <div className="metric-strip compact" aria-label="Resumo da NR-01">
            <div><span>Respostas</span><strong>{nr01Report.responseCount}</strong></div>
            <div><span>Quadro PGR</span><strong>{totalWorkers || "—"}</strong></div>
            <div><span>Cobertura</span><strong>{nr01Report.participationPercent === null ? "—" : `${nr01Report.participationPercent.toLocaleString("pt-BR")}%`}</strong></div>
          </div>
        ) : <StatusPill tone="neutral">Aguardando CSV</StatusPill>}
      </section>

      <section className="section-card">
        <div className="section-heading"><div><span className="eyebrow">Fonte dos dados</span><h2>Respostas do Google Forms</h2></div><p>O arquivo é processado no navegador e não é enviado a um servidor.</p></div>
        <input ref={nr01FileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={handleNr01File} aria-label="Selecionar CSV da NR-01" />
        {!nr01Dataset ? (
          <div className="nr01-upload-zone">
            <div className="nr01-upload-icon"><FileSpreadsheet aria-hidden="true" /></div>
            <div><strong>Selecione a exportação CSV do formulário</strong><span>O sistema reconhece as 11 perguntas, separa as respostas por local e inverte automaticamente as questões de exposição.</span></div>
            <Button type="button" onClick={() => nr01FileInputRef.current?.click()}><Upload /> Selecionar CSV</Button>
          </div>
        ) : (
          <div className="nr01-imported-file">
            <div className="nr01-file-icon"><FileSpreadsheet aria-hidden="true" /></div>
            <div className="nr01-file-copy"><strong>{nr01Dataset.sourceFileName}</strong><span>{nr01Dataset.responses.length} respostas válidas · {nr01Dataset.locations.length} locais · importado neste dispositivo</span></div>
            <div className="nr01-file-actions">
              <Button type="button" variant="outline" onClick={() => nr01FileInputRef.current?.click()}><Upload /> Substituir</Button>
              <Button type="button" variant="ghost" onClick={clearNr01Dataset} aria-label="Remover CSV importado"><Trash2 /> Remover</Button>
            </div>
          </div>
        )}
        {nr01Dataset?.skippedRows ? <div className="notice notice-amber"><AlertTriangle aria-hidden="true" /><div><strong>Linhas não utilizadas</strong><p>{nr01Dataset.skippedRows} linha(s) estavam incompletas ou continham respostas fora da escala esperada.</p></div></div> : null}
      </section>

      {nr01Dataset && (
        <section className="section-card">
          <div className="section-heading"><div><span className="eyebrow">Vinculação</span><h2>Local analisado neste PGR</h2></div><StatusPill tone={selectedNr01Location ? "ok" : "warn"}>{selectedNr01Location ? "Local vinculado" : "Seleção necessária"}</StatusPill></div>
          <div className="nr01-link-grid">
            <div>
              <FieldLabel htmlFor="nr01-location">Local informado no formulário</FieldLabel>
              <Select value={selectedNr01Location} onValueChange={selectNr01Location}>
                <SelectTrigger id="nr01-location" className="select-large"><SelectValue placeholder="Selecione o local correspondente" /></SelectTrigger>
                <SelectContent position="popper" className="max-w-[min(92vw,760px)]">
                  {nr01Dataset.locations.map((location) => {
                    const count = nr01Dataset.responses.filter((response) => response.location === location).length;
                    return <SelectItem key={location} value={location}>{location} · {count} resposta(s)</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              {automaticNr01Location && automaticNr01Location === selectedNr01Location && <p className="field-hint">Correspondência identificada automaticamente pelo nome ou CNPJ.</p>}
            </div>
            <label className={`nr01-include-card ${includeNr01 ? "nr01-include-active" : ""}`}>
              <Checkbox checked={includeNr01} onCheckedChange={(checked) => setNr01Included(checked === true)} disabled={!nr01Report} />
              <span><strong>Incluir no PGR em Word</strong><small>O relatório será acrescentado como anexo no mesmo arquivo.</small></span>
            </label>
          </div>
        </section>
      )}

      {nr01Dataset && !nr01Report && (
        <section className="empty-state section-card"><BarChart3 aria-hidden="true" /><h2>Selecione um local do CSV</h2><p>Escolha o local correspondente ao condomínio para calcular os indicadores.</p></section>
      )}

      {nr01Report && !nr01Report.canPublishDetailedResults && (
        <section className="section-card">
          <div className="notice notice-amber notice-flush"><AlertTriangle aria-hidden="true" /><div><strong>Amostra protegida por sigilo</strong><p>Há {nr01Report.responseCount} resposta(s) para este local. O Word incluirá o registro da aplicação, mas não exibirá médias, distribuições ou comentários enquanto houver menos de 3 respostas.</p></div></div>
          <div className="nr01-continuity-grid">
            <div><span>Período</span><strong>{nr01Report.startDate === nr01Report.endDate ? nr01Report.startDate : `${nr01Report.startDate} a ${nr01Report.endDate}`}</strong></div>
            <div><span>Encaminhamento</span><strong>Complementar com AEP e análise da atividade</strong></div>
          </div>
        </section>
      )}

      {nr01Report?.canPublishDetailedResults && (
        <>
          <section className="section-card">
            <div className="section-heading"><div><span className="eyebrow">Resultado agregado</span><h2>Indicadores por domínio</h2></div><p>Média favorável de 1 a 5. Quanto maior, melhor a condição percebida.</p></div>
            <div className="nr01-domain-grid">
              {nr01Report.domainResults.map((domain) => {
                const tone = domain.classification === "Alto" ? "high" : domain.classification === "Moderado" ? "warn" : "ok";
                return (
                  <article className={`nr01-domain-card nr01-domain-${tone}`} key={domain.id}>
                    <div className="nr01-domain-top"><div><span>{domain.label}</span><strong>{domain.average.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div><StatusPill tone={tone}>{domain.classification}</StatusPill></div>
                    <div className="nr01-score-track" aria-label={`${domain.average} de 5`}><span style={{ width: `${(domain.average / 5) * 100}%` }} /></div>
                    <p>{domain.riskFactor}</p>
                    <small>{domain.probability} · severidade {domain.severity.toLocaleLowerCase("pt-BR")} · reavaliar em {domain.reassessment}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="section-card">
            <div className="section-heading"><div><span className="eyebrow">Pontos de atenção</span><h2>Questões com menor média favorável</h2></div><StatusPill tone={nr01Report.overallClassification === "Alto" ? "high" : nr01Report.overallClassification === "Moderado" ? "warn" : "ok"}>Geral {nr01Report.overallAverage.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</StatusPill></div>
            <div className="risk-table-wrap"><table className="risk-table nr01-table"><thead><tr><th>Questão</th><th>Média</th><th>Favorável</th><th>Às vezes</th><th>Desfavorável</th></tr></thead><tbody>
              {nr01Report.criticalQuestions.map((question) => <tr key={question.id}><td><strong>{question.title}</strong><span>{question.prompt}</span></td><td>{question.average.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td><td>{question.favorablePercent.toLocaleString("pt-BR")}%</td><td>{question.neutralPercent.toLocaleString("pt-BR")}%</td><td>{question.unfavorablePercent.toLocaleString("pt-BR")}%</td></tr>)}
            </tbody></table></div>
          </section>

          <section className="section-card">
            <div className="section-heading"><div><span className="eyebrow">Composição da amostra</span><h2>Atividades e turnos</h2></div><p>Os comentários abertos não são exibidos para preservar a confidencialidade.</p></div>
            <div className="nr01-profile-grid">
              <div><h3>Grupos de atividades</h3><ul>{nr01Report.activityGroups.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.count} · {item.percentage.toLocaleString("pt-BR")}%</strong></li>)}</ul></div>
              <div><h3>Turnos</h3><ul>{nr01Report.shifts.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.count} · {item.percentage.toLocaleString("pt-BR")}%</strong></li>)}</ul></div>
            </div>
            <div className="notice notice-blue"><ClipboardCheck aria-hidden="true" /><div><strong>Critério documentado</strong><p>3,20 a 5,00: tolerável; 2,40 a 3,19: moderado; 1,00 a 2,39: alto. A severidade moderada é preliminar e deve ser validada pelo responsável técnico.</p></div></div>
          </section>
        </>
      )}
    </div>
  );

  const renderExport = () => (
    <div className="step-stack">
      <section className="section-card section-intro">
        <div><span className="eyebrow">Etapa 6 de 6</span><h1>Plano de ação e exportação</h1><p>Confirme as ações aplicáveis, complete responsáveis e prazos e gere o PGR em Word.</p></div>
        <StatusPill tone={warnings.length ? "warn" : "ok"}>{warnings.length ? `${warnings.length} pendência(s)` : "Pronto para exportar"}</StatusPill>
      </section>
      <section className="section-card">
        <div className="section-heading"><div><span className="eyebrow">Plano de ação</span><h2>{includedActions.length} ações incluídas</h2></div><p>Ações condicionais aparecem conforme as atividades marcadas.</p></div>
        <div className="action-list">
          {actionCatalog.map((action) => {
            const defaultIncluded = !action.condition || state.scenarios[action.condition];
            const settings = state.actions[action.id];
            const included = settings?.included ?? defaultIncluded;
            return (
              <div className={`action-row ${included ? "action-included" : ""}`} key={action.id}>
                <Checkbox checked={included} onCheckedChange={(checked) => toggleAction(action.id, checked === true)} aria-label={`Incluir ação ${action.action}`} />
                <div className="action-copy"><strong>{action.action}</strong><span>{action.ghe} · Prioridade {action.priority}</span></div>
                <div className="action-field"><span>Prazo</span><Input value={settings?.deadline ?? action.deadline} onChange={(event) => updateAction(action.id, { deadline: event.target.value })} disabled={!included} /></div>
                <div className="action-field action-owner"><span>Responsável</span><Input value={settings?.responsible ?? action.responsible} onChange={(event) => updateAction(action.id, { responsible: event.target.value })} disabled={!included} /></div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="export-card">
        <div className="export-document-icon"><FileCheck2 /></div>
        <div className="export-copy"><span className="eyebrow">Documento final</span><h2>PGR de {state.condoName || "condomínio"}</h2><p>{totalWorkers} trabalhador(es), {selectedRoles.length} função(ões), {includedRiskCount} riscos e {includedActions.length} ações.</p><div className="export-tags"><span>Formato .docx</span><span>Editável no Word</span><span>Gerado no dispositivo</span>{includeNr01 && nr01Report && <span>Relatório NR-01 incluído</span>}</div></div>
        <Button className="export-button" size="lg" onClick={handleGenerate} disabled={isGenerating || !selectedRoles.length}>{isGenerating ? <Sparkles className="animate-pulse" /> : <Download />}{isGenerating ? "Montando documento..." : "Gerar PGR em Word"}</Button>
      </section>
      <div className="notice notice-blue"><ClipboardCheck aria-hidden="true" /><div><strong>Validação profissional necessária</strong><p>O sistema organiza o conteúdo e aplica a matriz-base. A emissão definitiva continua dependendo de inspeção, avaliação técnica e assinatura do profissional responsável.</p></div></div>
    </div>
  );

  const currentStepContent = [renderIdentification, renderStaffing, renderActivities, renderInventory, renderNr01, renderExport][step]();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark" aria-hidden="true"><FileText /></div><div><strong>Gerador de PGR</strong><span>Condomínios · Grupo Dinamizza</span></div></div>
        <div className="topbar-actions">
          <span className={`connection-state ${isOnline ? "online" : "offline"}`}>{isOnline ? <Wifi /> : <WifiOff />}{isOnline ? "Salvo neste dispositivo" : "Modo offline ativo"}</span>
          {installPrompt && <Button variant="outline" onClick={handleInstall}><Download /> Instalar app</Button>}
          <Button onClick={handleGenerate} disabled={isGenerating || !selectedRoles.length} className="header-export"><Download /> <span className="desktop-label">Gerar Word</span></Button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="left-rail">
          <div className="rail-section condo-picker">
            <span className="rail-label">Documento em edição</span>
            <Select value={state.condoId} onValueChange={selectCondo}><SelectTrigger className="rail-select"><SelectValue /></SelectTrigger><SelectContent position="popper" className="max-w-[min(92vw,620px)]">{condoCatalog.map((condo) => <SelectItem key={condo.id} value={condo.id}>{condo.name}</SelectItem>)}</SelectContent></Select>
            <div className="rail-condo-meta"><span>{totalWorkers} trabalhadores</span><span>{selectedGheCount} GHEs</span></div>
          </div>
          <nav className="step-nav" aria-label="Etapas do PGR">
            {steps.map((item) => {
              const Icon = item.icon;
              const active = step === item.id;
              const complete = item.id < step;
              return <button type="button" key={item.id} className={`step-button ${active ? "step-active" : ""} ${complete ? "step-complete" : ""}`} onClick={() => setStep(item.id)} aria-current={active ? "step" : undefined}><span className="step-index">{complete ? <Check /> : <Icon />}</span><span><strong>{item.label}</strong><small>{item.short}</small></span></button>;
            })}
          </nav>
          <div className="rail-source"><CircleDot aria-hidden="true" /><div><strong>Base técnica</strong><span>PGR e relatório NR-01</span></div></div>
        </aside>

        <main className="main-workspace">
          {currentStepContent}
          <div className="step-footer">
            <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}><ArrowLeft /> Anterior</Button>
            {step < steps.length - 1 ? <Button onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Próxima etapa <ArrowRight /></Button> : <Button onClick={handleGenerate} disabled={isGenerating || !selectedRoles.length}><Download /> Gerar Word</Button>}
          </div>
        </main>

        <aside className="right-rail">
          <section className="readiness-card"><div className="readiness-top"><span className="eyebrow">Consistência</span><strong>{readiness}%</strong></div><Progress value={readiness} aria-label={`${readiness}% da configuração preenchida`} /><p>{warnings.length ? "Revise as pendências antes da assinatura." : "Os campos principais estão completos."}</p></section>
          <section className="summary-card"><h2>Resumo do documento</h2><dl><div><dt>Trabalhadores</dt><dd>{totalWorkers}</dd></div><div><dt>Funções</dt><dd>{selectedRoles.length}</dd></div><div><dt>GHEs</dt><dd>{selectedGheCount}</dd></div><div><dt>Riscos</dt><dd>{includedRiskCount}</dd></div><div><dt>Ações</dt><dd>{includedActions.length}</dd></div><div><dt>NR-01</dt><dd>{includeNr01 && nr01Report ? `${nr01Report.responseCount} resp.` : "—"}</dd></div></dl></section>
          <section className="pending-card"><h2>{warnings.length ? "Pendências" : "Conferência concluída"}</h2>{warnings.length ? <ul>{warnings.slice(0, 4).map((warning) => <li key={warning}><AlertTriangle /> <span>{warning}</span></li>)}</ul> : <div className="all-good"><Check /><span>Configuração pronta para revisão técnica.</span></div>}{warnings.length > 4 && <button type="button" onClick={() => setStep(5)}>Ver todas as {warnings.length} pendências</button>}</section>
        </aside>
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
