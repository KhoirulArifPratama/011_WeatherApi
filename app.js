const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

const apiKey = "vWXPrudoV4tnwNqYPVkL";

const TIPE = {
    region: "Provinsi",
    subregion: "Kabupaten/Kota",
    county: "Kabupaten/Kota",
    joint_municipality: "Kota",
    municipality: "Kota",
    municipal_district: "Kecamatan",
    locality: "Kecamatan",
    place: "Kota",
};

function cari(daftar, tipe) {
    for (const t of tipe) {
        const hit = daftar.find((d) => (d.id || "").startsWith(t + "."));
        if (hit) return hit.text || hit.place_name;
    }
    return "-";
}

// Saran utama: MapTiler
async function saranMapTiler(q) {
    const response = await axios.get(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`,
        { params: { key: apiKey, language: "id", limit: 10, autocomplete: true, proximity: "110,-2" } }
    );

    return response.data.features
        .filter((f) => TIPE[(f.place_type || [])[0]])
        .slice(0, 7)
        .map((f) => {
            const [longitude, latitude] = f.center || f.geometry.coordinates;
            return { nama: f.text, lengkap: f.place_name, tipe: TIPE[f.place_type[0]], longitude, latitude };
        });
}

// Saran cadangan: Open-Meteo Geocoding (gratis, tanpa key)
async function saranCadangan(q) {
    const r = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
        params: { name: q, count: 8, language: "id", format: "json" },
    });

    return (r.data.results || []).map((d) => ({
        nama: d.name,
        lengkap: [d.name, d.admin2, d.admin1, d.country].filter(Boolean).join(", "),
        tipe: d.feature_code === "ADM1" ? "Provinsi"
            : d.feature_code === "ADM3" || d.feature_code === "ADM4" ? "Kecamatan"
                : "Kabupaten/Kota",
        longitude: d.longitude,
        latitude: d.latitude,
    }));
}

app.get("/api/saran", async (req, res) => {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json([]);

    try {
        let hasil = [];
        try {
            hasil = await saranMapTiler(q);
        } catch (e) {
            console.error("Saran MapTiler gagal:", e.response ? e.response.status : "", e.message);
        }
        if (!hasil.length) hasil = await saranCadangan(q);
        res.json(hasil);
    } catch (error) {
        console.error("Saran gagal:", error.message);
        res.status(500).json({ message: "Saran lokasi tidak tersedia saat ini." });
    }
});

app.get("/api/lokasi", async (req, res) => {
    const kota = req.query.kota || "jakarta";

    const lon = parseFloat(req.query.lon);
    const lat = parseFloat(req.query.lat);
    const proximity = !isNaN(lon) && !isNaN(lat) ? `&proximity=${lon},${lat}` : "";

    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(kota)}.json?key=${apiKey}&language=id&limit=1${proximity}`;

    try {
        const response = await axios.get(url);

        const data = response.data;

        if (!data.features.length) {
            return res.status(404).json({ message: `Lokasi "${kota}" tidak ditemukan` });
        }

        const fitur = data.features[0];
        const lokasi = fitur.place_name;
        const koordinat = fitur.center || fitur.geometry.coordinates;
        const [longitude, latitude] = koordinat;

        let daftar = [fitur, ...(fitur.context || [])];
        try {
            const rev = await axios.get(
                `https://api.maptiler.com/geocoding/${longitude},${latitude}.json?key=${apiKey}&language=id`
            );
            rev.data.features.forEach((f) => daftar.push(f, ...(f.context || [])));
        } catch (e) {
            console.warn("Reverse geocoding gagal:", e.message);
        }

        // zona waktu lokasi (Open-Meteo, tanpa API key)
        let zona = null;
        try {
            const w = await axios.get("https://api.open-meteo.com/v1/forecast", {
                params: { latitude, longitude, current: "is_day", timezone: "auto" },
            });
            zona = { nama: w.data.timezone, offset: w.data.utc_offset_seconds };
        } catch (e) {
            console.warn("Zona waktu gagal:", e.message);
        }

        res.json({
            kota: lokasi,
            koordinat: koordinat,
            negara: cari(daftar, ["country"]),
            provinsi: cari(daftar, ["region"]),
            kecamatan: cari(daftar, ["municipality", "municipal_district", "joint_municipality", "subregion", "locality", "county"]),
            longitude: longitude,
            latitude: latitude,
            zona: zona,
        });
    } catch (error) {
        console.error(error.message);

        res.status(500).json({
            message: "Gagal mengambil data dari MapTiler",
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});