// v0.8.0-d — synchronous GeoIP lookup at ingest time.
//
// Reads MaxMind's `.mmdb` binary format. We default to DB-IP Lite
// IP-to-Country (CC-BY 4.0, country-only, no license key needed —
// the file is fetchable monthly from https://db-ip.com/). Operators
// can swap to GeoLite2 City for region + city precision by pointing
// `SENTORI_GEOIP_DB_PATH` at the city db; the loader inspects the
// `database_type` metadata and reads region/city only when present.
//
// Performance: `maxminddb::Reader` performs a B-tree walk over the
// memory-mapped DB. Lookup is microseconds on modern hardware. The
// reader is `Send + Sync` and lock-free for reads, so we hand it
// out behind `Arc<Reader>`.
//
// Failure mode: load failure (missing file, corrupt db) prints a
// warning at startup and the server runs without enrichment.
// `Event.geo` stays `None`; nothing is rejected.

use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;

use maxminddb::geoip2;
use serde::Deserialize;

use crate::event::Geo;

#[derive(Clone)]
pub struct GeoIpReader {
    reader: Arc<maxminddb::Reader<Vec<u8>>>,
}

impl GeoIpReader {
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let reader = maxminddb::Reader::open_readfile(path.as_ref())?;
        Ok(Self {
            reader: Arc::new(reader),
        })
    }

    /// Best-effort lookup. Returns `None` when the IP is unmapped
    /// (private range, multicast, the db simply doesn't have it).
    pub fn lookup(&self, ip: IpAddr) -> Option<Geo> {
        // Try City first — works on both DB-IP Lite Country and
        // GeoLite2 City because the City schema is a superset.
        // `maxminddb` returns `AddressNotFoundError` on miss; we
        // treat all errors the same: no enrichment.
        if let Ok(city) = self.reader.lookup::<CityLite>(ip) {
            let country = city
                .country
                .and_then(|c| c.iso_code)
                .map(|s| s.to_string());
            let region = city
                .subdivisions
                .and_then(|subs| subs.into_iter().next())
                .and_then(|s| s.iso_code)
                .map(|s| s.to_string());
            let city_name = city
                .city
                .and_then(|c| c.names)
                .and_then(|n| n.get("en").map(|s| s.to_string()));
            return country.map(|country| Geo {
                country,
                region,
                city: city_name,
            });
        }
        None
    }
}

/// Subset of `geoip2::City` we actually read. Defined separately
/// because the upstream `geoip2::City` borrows from the db buffer,
/// which forces lifetimes through this module — we copy out into
/// owned `String`s for the response anyway.
#[derive(Deserialize)]
struct CityLite<'a> {
    #[serde(borrow)]
    country: Option<geoip2::city::Country<'a>>,
    #[serde(default, borrow)]
    subdivisions: Option<Vec<geoip2::city::Subdivision<'a>>>,
    #[serde(borrow)]
    city: Option<geoip2::city::City<'a>>,
}

/// Parse the client IP from `x-forwarded-for` (first hop closest to
/// the client) or the peer address. Localhost / private ranges get
/// filtered out — they can't be looked up and we don't want misleading
/// `None`s in the metric.
pub fn client_ip_from_headers_or_peer(
    headers: &axum::http::HeaderMap,
    peer: Option<IpAddr>,
) -> Option<IpAddr> {
    if let Some(v) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        // `x-forwarded-for` is comma-separated; the leftmost entry
        // is the original client (each proxy appends its own peer).
        if let Some(first) = v.split(',').next() {
            if let Ok(ip) = first.trim().parse::<IpAddr>() {
                if !is_private(ip) {
                    return Some(ip);
                }
            }
        }
    }
    peer.filter(|ip| !is_private(*ip))
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}
