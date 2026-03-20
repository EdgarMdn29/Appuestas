import { NextResponse } from "next/server";

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

type AnalyzeRequestBody = {
    league?: string;
    date?: string;
    matches?: Match[];
    useMock?: boolean;
    forceRefresh?: boolean;
};

type CachedEntry = {
    expiresAt: number;
    source: "mock" | "openrouter" | "fallback-mock";
    result: AnalysisResult;
};

const ANALYSIS_CACHE = new Map<string, CachedEntry>();
const ONE_HOUR_MS = 60 * 60 * 1000;

function getMatchLabel(match: Match) {
    return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function getConfidenceLabel(rating: number) {
    if (rating >= 8.5) return "Alta";
    if (rating >= 6.5) return "Media";
    return "Baja";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}

function getUnitsFromRating(rating: number) {
    if (rating === 10) return 5;
    if (rating >= 9.5) return 4;
    if (rating >= 8.0) return 3;
    if (rating >= 4.0) return 2;
    return 1;
}

function truncateText(value: unknown, max = 500, fallback = "") {
    const text = typeof value === "string" ? value.trim() : fallback;
    return text.slice(0, max);
}

function makeCacheKey(body: AnalyzeRequestBody, useMock: boolean) {
    return JSON.stringify({
        league: body.league ?? "",
        date: body.date ?? "",
        useMock,
        matches: (body.matches ?? []).map((m) => ({
            id: m.id,
            date: m.date,
            startDateTimeUtc: m.startDateTimeUtc,
            homeTeam: m.homeTeam.name,
            awayTeam: m.awayTeam.name,
            status: m.status,
            time: m.time,
            round: m.round,
        })),
    });
}

function buildMockResponse(matches: Match[] = [], league?: string, date?: string): AnalysisResult {
    const safeMatches = matches.slice(0, 3);

    if (safeMatches.length === 0) {
        return {
            summary: "No hay partidos disponibles para analizar.",
            dataReliability: 1.0,
            bestBets: [],
            parlays: [],
            playerProps: [],
            bestPickOfTheDay: null,
            recommendedExposureUnits: 0,
        };
    }

    const firstMatch = safeMatches[0];
    const secondMatch = safeMatches[1];

    const bestBets: BestBet[] = [
        {
            market: "Total Goals",
            pick: `${getMatchLabel(firstMatch)} - Más de 1.5 goles`,
            rating: 6.9,
            units: 2,
            justification:
                "Es el mercado más prudente cuando la información disponible es limitada. La línea de más de 1.5 goles tolera distintos guiones de partido mejor que mercados más agresivos.",
            risk:
                "Puede fallar si el encuentro arranca cerrado, con ritmo bajo, poca generación ofensiva o un planteamiento muy conservador de ambos lados.",
            dataReliability: 4.8,
            confidenceLabel: "Media",
            recommendedMarketPriority: 1,
            favoriteTrap: false,
            lowData: true,
            profile: "conservador",
        },
        ...(secondMatch
            ? [
                {
                    market: "Double Chance",
                    pick: `${getMatchLabel(secondMatch)} - Local o empate`,
                    rating: 6.4,
                    units: 2,
                    justification:
                        "La doble oportunidad reduce exposición frente al moneyline puro y encaja mejor cuando todavía no hay datos suficientes para sostener una postura más agresiva.",
                    risk:
                        "Pierde valor si el visitante llega en mejor forma real, si hay una diferencia táctica importante o si el local no aprovecha la ventaja de sede.",
                    dataReliability: 4.3,
                    confidenceLabel: "Baja",
                    recommendedMarketPriority: 2,
                    favoriteTrap: false,
                    lowData: true,
                    profile: "conservador",
                },
            ]
            : []),
    ];

    return {
        summary: `Análisis preliminar para ${league ?? "liga"} del ${date ?? "día"}. Se priorizan mercados conservadores por la falta de datos avanzados, pero aun así se muestran ángulos utilizables.`,
        dataReliability: 4.6,
        bestBets,
        parlays: [],
        playerProps: [],
        bestPickOfTheDay: bestBets[0] ?? null,
        recommendedExposureUnits: bestBets.reduce((acc, bet) => acc + bet.units, 0),
    };
}

function normalizeBestBet(raw: any, index: number): BestBet {
    const rating = clampNumber(raw?.rating, 1, 10, 5.5);
    const dataReliability = clampNumber(raw?.dataReliability, 1, 10, 4.5);

    return {
        market: truncateText(raw?.market, 120, "Mercado no especificado"),
        pick: truncateText(raw?.pick, 200, "Pick no especificado"),
        rating,
        units: getUnitsFromRating(rating),
        justification: truncateText(
            raw?.justification,
            500,
            "Justificación no especificada."
        ),
        risk: truncateText(raw?.risk, 500, "Riesgo no especificado."),
        dataReliability,
        confidenceLabel: truncateText(
            raw?.confidenceLabel,
            30,
            getConfidenceLabel(rating)
        ),
        recommendedMarketPriority: clampNumber(
            raw?.recommendedMarketPriority,
            1,
            99,
            index + 1
        ),
        favoriteTrap: Boolean(raw?.favoriteTrap),
        lowData: Boolean(raw?.lowData ?? dataReliability < 5),
        profile: raw?.profile === "agresivo" ? "agresivo" : "conservador",
    };
}

function normalizeAnalysisResult(raw: any): AnalysisResult {
    const bestBetsRaw = Array.isArray(raw?.bestBets) ? raw.bestBets : [];
    const parlaysRaw = Array.isArray(raw?.parlays) ? raw.parlays : [];
    const playerPropsRaw = Array.isArray(raw?.playerProps) ? raw.playerProps : [];

    const bestBets = bestBetsRaw
        .map((bet, index) => normalizeBestBet(bet, index))
        .sort((a, b) => {
            if (a.recommendedMarketPriority !== b.recommendedMarketPriority) {
                return a.recommendedMarketPriority - b.recommendedMarketPriority;
            }
            return b.rating - a.rating;
        });

    const parlays: Parlay[] = parlaysRaw.slice(0, 2).map((parlay: any) => {
        const rating = clampNumber(parlay?.rating, 1, 10, 5.5);
        return {
            name: truncateText(parlay?.name, 120, "Parlay"),
            legs: Array.isArray(parlay?.legs)
                ? parlay.legs.map((leg: unknown) => truncateText(leg, 120, "")).filter(Boolean)
                : [],
            rating,
            units: Math.min(getUnitsFromRating(rating), 2),
            justification: truncateText(parlay?.justification, 500, "Justificación no especificada."),
            risk: truncateText(parlay?.risk, 500, "Riesgo no especificado."),
        };
    });

    const playerProps: PlayerProp[] = playerPropsRaw.slice(0, 2).map((prop: any) => {
        const rating = clampNumber(prop?.rating, 1, 10, 4.5);
        return {
            player: truncateText(prop?.player, 120, "Jugador no especificado"),
            market: truncateText(prop?.market, 120, "Mercado no especificado"),
            pick: truncateText(prop?.pick, 200, "Pick no especificado"),
            rating,
            units: getUnitsFromRating(rating),
            justification: truncateText(prop?.justification, 500, "Justificación no especificada."),
            risk: truncateText(prop?.risk, 500, "Riesgo no especificado."),
        };
    });

    const bestPickOfTheDay = bestBets[0] ?? null;
    const recommendedExposureUnits = bestBets.reduce((acc, bet) => acc + bet.units, 0);

    return {
        summary: truncateText(raw?.summary, 600, "Análisis generado con datos limitados."),
        dataReliability: clampNumber(raw?.dataReliability, 1, 10, 4.5),
        bestBets,
        parlays,
        playerProps,
        bestPickOfTheDay,
        recommendedExposureUnits,
    };
}

export async function POST(req: Request) {
    try {
        const body: AnalyzeRequestBody = await req.json();
        const matches = Array.isArray(body?.matches) ? body.matches : [];

        if (matches.length === 0) {
            return NextResponse.json(
                { error: "Missing matches for analysis" },
                { status: 400 }
            );
        }

        const useMock = body?.useMock ?? (process.env.ANALYZE_USE_MOCK === "true");
        const forceRefresh = body?.forceRefresh === true;
        const cacheKey = makeCacheKey(body, useMock);

        if (!forceRefresh) {
            const cached = ANALYSIS_CACHE.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return NextResponse.json({
                    result: cached.result,
                    source: cached.source,
                    cached: true,
                    cacheTtlMs: cached.expiresAt - Date.now(),
                });
            }
        }

        if (useMock) {
            const result = buildMockResponse(matches, body.league, body.date);

            ANALYSIS_CACHE.set(cacheKey, {
                result,
                source: "mock",
                expiresAt: Date.now() + ONE_HOUR_MS,
            });

            return NextResponse.json({
                result,
                source: "mock",
                cached: false,
                cacheTtlMs: ONE_HOUR_MS,
            });
        }

        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: "Missing OPENROUTER_API_KEY" },
                { status: 500 }
            );
        }

        const systemPrompt = `
You are a professional football betting analyst.

Your job is NOT to predict results.
Your job is to identify the most logical and disciplined betting angles based ONLY on the data provided.

STRICT OUTPUT RULES
- Respond ONLY with valid JSON.
- Do not use markdown or code fences.
- Do not invent matches, players, stats, injuries, standings, or odds.
- Analyze only the matches in the input.
- Always return analysis, even with limited data.
- If data is limited, reduce rating and dataReliability, but still suggest conservative picks when possible.

RESPONSE FORMAT
{
  "summary": "string",
  "dataReliability": 0,
  "bestBets": [
    {
      "market": "string",
      "pick": "string",
      "rating": 0,
      "units": 0,
      "justification": "string",
      "risk": "string",
      "dataReliability": 0,
      "confidenceLabel": "string",
      "recommendedMarketPriority": 0,
      "favoriteTrap": false,
      "lowData": false,
      "profile": "conservador"
    }
  ],
  "parlays": [
    {
      "name": "string",
      "legs": ["string"],
      "rating": 0,
      "units": 0,
      "justification": "string",
      "risk": "string"
    }
  ],
  "playerProps": [
    {
      "player": "string",
      "market": "string",
      "pick": "string",
      "rating": 0,
      "units": 0,
      "justification": "string",
      "risk": "string"
    }
  ]
}

ANALYSIS PRIORITIES
1. Goals scored and goals conceded trends
2. Recent form
3. Home vs away behavior
4. Title / relegation / urgency context
5. Favorite overconfidence risk
6. Underdog danger
7. Match rhythm (open or closed)

BETTING DISCIPLINE
- Usually include at least 1 bestBet when matches exist.
- Prefer conservative markets if data is weak.
- Avoid over-aggressive picks without support.
- Parlay is optional and should be rare.
- Player props should usually be empty unless justified.

RATING RULES
- rating: 1.0 to 10.0
- dataReliability: 1.0 to 10.0
- If data is limited, keep rating below 8.0
- confidenceLabel should match the rating logically
- recommendedMarketPriority: 1 is highest priority
- Mark favoriteTrap true when the favorite looks risky
- Mark lowData true when support is limited
- profile must be "conservador" or "agresivo"

TEXT RULES
- summary concise
- justification max 500 chars
- risk max 500 chars
`.trim();

        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "openai/gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt,
                        },
                        {
                            role: "user",
                            content: JSON.stringify({
                                league: body.league,
                                date: body.date,
                                matches,
                            }),
                        },
                    ],
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error?.message ||
                    data?.error ||
                    "OpenRouter request failed"
                );
            }

            const content = data?.choices?.[0]?.message?.content ?? "";
            const parsed = JSON.parse(content);
            const result = normalizeAnalysisResult(parsed);

            ANALYSIS_CACHE.set(cacheKey, {
                result,
                source: "openrouter",
                expiresAt: Date.now() + ONE_HOUR_MS,
            });

            return NextResponse.json({
                result,
                source: "openrouter",
                cached: false,
                cacheTtlMs: ONE_HOUR_MS,
            });
        } catch (modelError) {
            const fallback = buildMockResponse(matches, body.league, body.date);

            ANALYSIS_CACHE.set(cacheKey, {
                result: fallback,
                source: "fallback-mock",
                expiresAt: Date.now() + ONE_HOUR_MS,
            });

            return NextResponse.json({
                result: fallback,
                source: "fallback-mock",
                cached: false,
                cacheTtlMs: ONE_HOUR_MS,
                modelError:
                    modelError instanceof Error ? modelError.message : "Unknown model error",
            });
        }
    } catch (error) {
        return NextResponse.json(
            {
                error: "Unexpected server error",
                details: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}