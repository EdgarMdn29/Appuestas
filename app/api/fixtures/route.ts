/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

const API_KEY = process.env.SPORTDB_API_KEY!;

const LEAGUES: Record<
    string,
    {
        path: string;
        season: string;
    }
> = {
    EPL: {
        path: "england:198/premier-league:dYlOSQOD",
        season: "2025-2026",
    },

    ES: {
        path: "spain:176/laliga:QVmLl54o",
        season: "2025-2026",
    },

    IT: {
        path: "italy:98/serie-a:COuk57Ci",
        season: "2025-2026",
    },

    MX: {
        path: "mexico:128/liga-mx:bm2Vlsfl",
        season: "2025-2026",
    },
};

function toISODate(dateStr?: string) {
    if (dateStr) return dateStr;

    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
}

function extractMatchDateInCDMX(value?: string | null) {
    if (!value) return null;

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;

    if (!year || !month || !day) return null;

    return `${year}-${month}-${day}`;
}

function formatMatchTime(value?: string | null) {
    if (!value) return "-";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";

    return d.toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Mexico_City",
    });
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);

    const league = (searchParams.get("league") || "EPL").toUpperCase();
    const date = toISODate(searchParams.get("date") || undefined);

    const selectedLeague = LEAGUES[league];

    if (!selectedLeague) {
        return NextResponse.json(
            { error: "Invalid league. Use EPL, ES, IT, MX." },
            { status: 400 }
        );
    }

    try {
        const url = `https://api.sportdb.dev/api/flashscore/football/${selectedLeague.path}/${selectedLeague.season}/fixtures?page=1`;

        const res = await fetch(url, {
            headers: {
                "X-API-Key": API_KEY,
            },
            cache: "no-store",
        });

        if (!res.ok) {
            const body = await res.text();
            return NextResponse.json(
                { error: "SportDB error", details: body },
                { status: res.status }
            );
        }

        const data = await res.json();

        const normalized = data.map((e: any) => ({
            id: e.eventId,
            date: extractMatchDateInCDMX(e.startDateTimeUtc),
            startDateTimeUtc: e.startDateTimeUtc ?? null,

            homeTeam: {
                name: e.homeName,
                logo: e.homeLogo,
                score: e.homeScore ?? null,
            },

            awayTeam: {
                name: e.awayName,
                logo: e.awayLogo,
                score: e.awayScore ?? null,
            },

            status: e.eventStage,
            time: formatMatchTime(e.startDateTimeUtc),
            round: e.round ?? null,
        }));

        const matches = normalized.filter((m: any) => m.date === date);

        return NextResponse.json({
            league,
            date,
            totalMatches: matches.length,
            matches,
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: "Internal error", details: err.message },
            { status: 500 }
        );
    }
}