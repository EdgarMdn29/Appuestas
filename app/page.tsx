"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Match = {
    id: string;
    date: string;
    startDateTimeUtc: string | null;
    homeTeam: {
        name: string;
        logo: string;
        score: number | null;
    };
    awayTeam: {
        name: string;
        logo: string;
        score: number | null;
    };
    status: string;
    time: string;
    round: string | null;
};

type FixturesResponse = {
    league?: string;
    date?: string;
    totalMatches?: number;
    matches?: Match[];
    error?: string;
};

type BestBet = {
    market: string;
    pick: string;
    rating: number;
    units: number;
    justification: string;
    risk: string;
    dataReliability: number;
    confidenceLabel: string;
    recommendedMarketPriority: number;
    favoriteTrap: boolean;
    lowData: boolean;
    profile: "conservador" | "agresivo";
};

type Parlay = {
    name: string;
    legs: string[];
    rating: number;
    units: number;
    justification: string;
    risk: string;
};

type PlayerProp = {
    player: string;
    market: string;
    pick: string;
    rating: number;
    units: number;
    justification: string;
    risk: string;
};

type AnalysisResult = {
    summary: string;
    dataReliability: number;
    bestBets: BestBet[];
    parlays: Parlay[];
    playerProps: PlayerProp[];
    bestPickOfTheDay: BestBet | null;
    recommendedExposureUnits: number;
};

function toISODate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

const LEAGUES = [
    { key: "MX", label: "Liga MX", flag: "🇲🇽" },
    { key: "ES", label: "LaLiga", flag: "🇪🇸" },
    { key: "EPL", label: "Premier", flag: "🇬🇧" },
    { key: "IT", label: "Serie A", flag: "🇮🇹" },
] as const;

function getReliabilityLabel(score: number) {
    if (score >= 8) return "Alta";
    if (score >= 5) return "Media";
    return "Baja";
}


function getReliabilityClasses(score: number) {
    if (score >= 8) {
        return "bg-green-100 text-green-800";
    }
    if (score >= 5) {
        return "bg-yellow-100 text-yellow-800";
    }
    return "bg-red-100 text-red-800";
}

function getRatingClasses(score: number) {
    if (score >= 8) {
        return "bg-green-100 text-green-800";
    }
    if (score >= 6.5) {
        return "bg-yellow-100 text-yellow-800";
    }
    return "bg-red-100 text-red-800";
}

export default function Page() {
    const today = useMemo(() => new Date(), []);
    const minDate = useMemo(() => toISODate(today), [today]);
    const maxDate = useMemo(() => toISODate(addDays(today, 3)), [today]);

    const [selectedLeague, setSelectedLeague] = useState<string>("EPL");
    const [selectedDate, setSelectedDate] = useState<string>(minDate);

    const [matches, setMatches] = useState<Match[]>([]);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [analysisSource, setAnalysisSource] = useState<string | null>(null);
    const [analysisCached, setAnalysisCached] = useState(false);
    const [cacheTtlMs, setCacheTtlMs] = useState<number | null>(null);

    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState("");
    const [useMock, setUseMock] = useState(true);
    const [showParlays, setShowParlays] = useState(true);
    const [showPlayerProps, setShowPlayerProps] = useState(true);

    const fixturesCacheRef = useRef<Record<string, Match[]>>({});

    const dateInputRef = useRef<HTMLInputElement | null>(null);

    const openCalendar = () => {
        const el = dateInputRef.current;
        if (!el) return;

        // @ts-ignore
        if (typeof el.showPicker === "function") el.showPicker();
        else el.focus();
    };

    useEffect(() => {
        async function loadMatches() {
            const cacheKey = `${selectedLeague}_${selectedDate}`;

            if (fixturesCacheRef.current[cacheKey]) {
                setMatches(fixturesCacheRef.current[cacheKey]);
                return;
            }

            setLoading(true);
            setError("");
            setAnalysis(null);
            setAnalysisSource(null);
            setAnalysisCached(false);
            setCacheTtlMs(null);

            try {
                const res = await fetch(
                    `/api/fixtures?league=${selectedLeague}&date=${selectedDate}`,
                    { cache: "no-store" }
                );

                const data: FixturesResponse = await res.json();

                if (!res.ok || data.error) {
                    setMatches([]);
                    setError(data.error || "Error cargando partidos");
                    return;
                }

                const newMatches = data.matches || [];
                fixturesCacheRef.current[cacheKey] = newMatches;
                setMatches(newMatches);
            } catch {
                setMatches([]);
                setError("Error de red cargando partidos");
            } finally {
                setLoading(false);
            }
        }

        loadMatches();
    }, [selectedLeague, selectedDate]);

    async function runAnalysis(forceRefresh = false) {
        setAnalyzing(true);
        setError("");
        setAnalysisSource(null);

        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    league: selectedLeague,
                    date: selectedDate,
                    matches,
                    useMock,
                    forceRefresh,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Error ejecutando análisis");
                setAnalysis(null);
                setAnalysisSource(null);
                setAnalysisCached(false);
                setCacheTtlMs(null);
                return;
            }

            setAnalysis(data.result || null);
            setAnalysisSource(data.source || null);
            setAnalysisCached(Boolean(data.cached));
            setCacheTtlMs(typeof data.cacheTtlMs === "number" ? data.cacheTtlMs : null);

            if (data.modelError) {
                setError(`Se usó fallback: ${data.modelError}`);
            }
        } catch {
            setError("Error ejecutando análisis");
            setAnalysis(null);
            setAnalysisSource(null);
            setAnalysisCached(false);
            setCacheTtlMs(null);
        } finally {
            setAnalyzing(false);
        }
    }

    async function handleAnalyze() {
        await runAnalysis(false);
    }

    async function handleReanalyze() {
        await runAnalysis(true);
    }

    return (
        <main className="min-h-screen p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">Apuestas - Programa</h1>

                <button
                    type="button"
                    onClick={() => setUseMock((prev) => !prev)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold text-white ${
                        useMock ? "bg-green-600" : "bg-gray-700"
                    }`}
                >
                    {useMock ? "MOCK ON" : "MOCK OFF"}
                </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">Fecha</span>

                <input
                    ref={dateInputRef}
                    type="date"
                    value={selectedDate}
                    min={minDate}
                    max={maxDate}
                    onClick={openCalendar}
                    onFocus={openCalendar}
                    onKeyDown={(e) => e.preventDefault()}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                />

                <span className="text-xs text-gray-500">(hoy + 3 días)</span>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
                {LEAGUES.map((league) => {
                    const isSelected = selectedLeague === league.key;

                    return (
                        <button
                            key={league.key}
                            type="button"
                            onClick={() => setSelectedLeague(league.key)}
                            className={`rounded-md border px-4 py-2 text-sm font-medium ${
                                isSelected ? "bg-gray-900 text-white" : "bg-white text-black"
                            }`}
                        >
                            <span className="mr-2">{league.flag}</span>
                            <span>{league.label}</span>
                        </button>
                    );
                })}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={loading || analyzing || matches.length === 0}
                    className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                    {analyzing ? "Analizando..." : "Análisis"}
                </button>

                <button
                    type="button"
                    onClick={handleReanalyze}
                    disabled={loading || analyzing || matches.length === 0}
                    className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                    {analyzing ? "Reanalizando..." : "Reanalizar"}
                </button>

                <button
                    type="button"
                    onClick={() => setShowParlays((prev) => !prev)}
                    className="rounded-md border px-3 py-2 text-xs font-medium"
                >
                    {showParlays ? "Ocultar Parlays" : "Mostrar Parlays"}
                </button>

                <button
                    type="button"
                    onClick={() => setShowPlayerProps((prev) => !prev)}
                    className="rounded-md border px-3 py-2 text-xs font-medium"
                >
                    {showPlayerProps ? "Ocultar Props" : "Mostrar Props"}
                </button>
            </div>

            {analyzing && (
                <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    Analizando jornada...
                </div>
            )}

            {error && (
                <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="mt-6 rounded-md border p-4">
                {loading && <p>Cargando partidos...</p>}

                {!loading && matches.length === 0 && (
                    <p>No hay partidos para esa fecha.</p>
                )}

                {!loading && matches.length > 0 && (
                    <table className="w-full border-collapse text-sm">
                        <thead>
                        <tr className="border-b bg-gray-50">
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-left">Visitante</th>
                            <th className="p-3 text-left">Hora</th>
                            <th className="p-3 text-left">Estado</th>
                            <th className="p-3 text-left">Jornada</th>
                        </tr>
                        </thead>

                        <tbody>
                        {matches.map((match) => (
                            <tr key={match.id} className="border-b">
                                <td className="p-3">
                                    <div className="flex items-center gap-2">
                                        {match.homeTeam.logo && (
                                            <img
                                                src={match.homeTeam.logo}
                                                alt={match.homeTeam.name}
                                                className="h-5 w-5 object-contain"
                                            />
                                        )}
                                        <span>{match.homeTeam.name}</span>
                                    </div>
                                </td>
                                <td className="p-3">
                                    <div className="flex items-center gap-2">
                                        {match.awayTeam.logo && (
                                            <img
                                                src={match.awayTeam.logo}
                                                alt={match.awayTeam.name}
                                                className="h-5 w-5 object-contain"
                                            />
                                        )}
                                        <span>{match.awayTeam.name}</span>
                                    </div>
                                </td>
                                <td className="p-3">{match.time}</td>
                                <td className="p-3">{match.status}</td>
                                <td className="p-3">{match.round ?? "-"}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </div>

            {analysis && (
                <div className="mt-6 space-y-6">
                    <div className="rounded-md border p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <h2 className="font-semibold">Resumen</h2>

                            <span
                                className={`rounded px-2 py-1 text-xs font-medium ${getReliabilityClasses(
                                    analysis.dataReliability
                                )}`}
                            >
                                Fiabilidad de datos: {analysis.dataReliability.toFixed(1)} / 10
                            </span>

                            <span
                                className={`rounded px-2 py-1 text-xs font-medium ${getReliabilityClasses(
                                    analysis.dataReliability
                                )}`}
                            >
                                {getReliabilityLabel(analysis.dataReliability)}
                            </span>


                            {analysisCached && (
                                <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                    Cacheado
                                </span>
                            )}

                            {cacheTtlMs !== null && (
                                <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                    TTL: {Math.ceil(cacheTtlMs / 60000)} min
                                </span>
                            )}

                            <span className="rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800">
                                Liga: {LEAGUES.find((x) => x.key === selectedLeague)?.label ?? selectedLeague}
                            </span>

                        </div>

                        <p className="text-sm">{analysis.summary}</p>
                    </div>

                    {analysis.bestPickOfTheDay && (
                        <div className="rounded-md border border-green-300 bg-green-50 p-4">
                            <h2 className="mb-3 font-semibold text-green-900">Mejor Pick del Día</h2>

                            <div className="flex flex-wrap items-center gap-3">
                                <span className="font-semibold">{analysis.bestPickOfTheDay.market}</span>
                                <span className="text-sm text-gray-700">{analysis.bestPickOfTheDay.pick}</span>
                                <span
                                    className={`rounded px-2 py-1 text-xs font-medium ${getRatingClasses(
                                        analysis.bestPickOfTheDay.rating
                                    )}`}
                                >
                                    Rating: {analysis.bestPickOfTheDay.rating}
                                </span>
                                <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                    Units: {analysis.bestPickOfTheDay.units}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="rounded-md border p-4">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                            <h2 className="font-semibold">Best Bets</h2>

                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                Exposición sugerida: {analysis.recommendedExposureUnits}u
                            </span>
                        </div>

                        <div className="space-y-4">
                            {analysis.bestBets.map((bet, i) => (
                                <div key={i} className="rounded-md border p-4">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="font-semibold">{bet.market}</span>
                                        <span className="text-sm text-gray-600">{bet.pick}</span>

                                        <span
                                            className={`rounded px-2 py-1 text-xs font-medium ${getRatingClasses(
                                                bet.rating
                                            )}`}
                                        >
                                            Rating: {bet.rating}
                                        </span>

                                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                            Units: {bet.units}
                                        </span>

                                        <span
                                            className={`rounded px-2 py-1 text-xs font-medium ${getReliabilityClasses(
                                                bet.dataReliability
                                            )}`}
                                        >
                                            Data: {bet.dataReliability.toFixed(1)}
                                        </span>

                                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                            {bet.confidenceLabel}
                                        </span>

                                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                            Prioridad: {bet.recommendedMarketPriority}
                                        </span>

                                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                            Perfil: {bet.profile}
                                        </span>

                                        {bet.favoriteTrap && (
                                            <span className="rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
                                                Favorite Trap
                                            </span>
                                        )}

                                        {bet.lowData && (
                                            <span className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                                                Low Data
                                            </span>
                                        )}
                                    </div>

                                    <p className="mt-3 text-sm">{bet.justification}</p>
                                    <p className="mt-2 text-sm text-red-600">Riesgo: {bet.risk}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {showParlays && analysis.parlays.length > 0 && (
                        <div className="rounded-md border p-4">
                            <h2 className="mb-4 font-semibold">Parlays</h2>

                            <div className="space-y-4">
                                {analysis.parlays.map((parlay, i) => (
                                    <div key={i} className="rounded-md border p-4">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="font-semibold">{parlay.name}</span>
                                            <span
                                                className={`rounded px-2 py-1 text-xs font-medium ${getRatingClasses(
                                                    parlay.rating
                                                )}`}
                                            >
                                                Rating: {parlay.rating}
                                            </span>
                                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                                Units: {parlay.units}
                                            </span>
                                        </div>

                                        <ul className="mt-3 list-disc pl-5 text-sm">
                                            {parlay.legs.map((leg, j) => (
                                                <li key={j}>{leg}</li>
                                            ))}
                                        </ul>

                                        <p className="mt-3 text-sm">{parlay.justification}</p>
                                        <p className="mt-2 text-sm text-red-600">Riesgo: {parlay.risk}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {showPlayerProps && analysis.playerProps.length > 0 && (
                        <div className="rounded-md border p-4">
                            <h2 className="mb-4 font-semibold">Player Props</h2>

                            <div className="space-y-4">
                                {analysis.playerProps.map((prop, i) => (
                                    <div key={i} className="rounded-md border p-4">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="font-semibold">{prop.player}</span>
                                            <span className="text-sm text-gray-600">{prop.market}</span>
                                            <span className="text-sm">{prop.pick}</span>
                                            <span
                                                className={`rounded px-2 py-1 text-xs font-medium ${getRatingClasses(
                                                    prop.rating
                                                )}`}
                                            >
                                                Rating: {prop.rating}
                                            </span>
                                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                                Units: {prop.units}
                                            </span>
                                        </div>

                                        <p className="mt-3 text-sm">{prop.justification}</p>
                                        <p className="mt-2 text-sm text-red-600">Riesgo: {prop.risk}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </main>
    );
}