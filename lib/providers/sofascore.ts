export async function getScheduledEventsByDate(date: string) {
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;

    const res = await fetch(url, {
        headers: {
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            accept: "application/json, text/plain, */*",
            "accept-language": "es-MX,es;q=0.9,en;q=0.8",
            referer: "https://www.sofascore.com/",
            origin: "https://www.sofascore.com",
            // a veces ayuda:
            "cache-control": "no-cache",
            pragma: "no-cache",
        },
        cache: "no-store",
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `SofaScore ${res.status} ${res.statusText}: ${body.slice(0, 300)}`
        );
    }

    const data = await res.json();
    return data.events ?? [];
}