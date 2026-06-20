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
    /// v1.1 chunk S1 — optional ASN reader. Loaded from
    /// `SENTORI_ASN_DB_PATH` at boot when present (MaxMind GeoLite2
    /// ASN .mmdb); the main City lookup runs independently so an
    /// operator can deploy either db on its own.
    asn_reader: Option<Arc<maxminddb::Reader<Vec<u8>>>>,
}

impl GeoIpReader {
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let reader = maxminddb::Reader::open_readfile(path.as_ref())?;
        Ok(Self {
            reader: Arc::new(reader),
            asn_reader: None,
        })
    }

    /// v1.1 chunk S1 — attach an ASN db. Idempotent: replaces any
    /// previously-attached reader so live reloads work the same as
    /// startup.
    pub fn with_asn<P: AsRef<Path>>(mut self, path: P) -> anyhow::Result<Self> {
        let asn = maxminddb::Reader::open_readfile(path.as_ref())?;
        self.asn_reader = Some(Arc::new(asn));
        Ok(self)
    }

    /// Best-effort lookup. Returns `None` when the IP is unmapped
    /// (private range, multicast, the db simply doesn't have it).
    pub fn lookup(&self, ip: IpAddr) -> Option<Geo> {
        // Try City first — works on both DB-IP Lite Country and
        // GeoLite2 City because the City schema is a superset. In
        // maxminddb 0.28 `lookup` returns a `LookupResult` whether or
        // not the IP was found; `decode::<T>()` returns Ok(None) for
        // "not present in db", Ok(Some(_)) for found, Err for actual
        // parse errors. All three cases collapse to "no enrichment."
        let result = self.reader.lookup(ip).ok()?;
        let city = result.decode::<CityLite<'_>>().ok().flatten()?;
        let country = city
            .country
            .and_then(|c| c.iso_code)
            .map(|s| s.to_string());
        let region = city
            .subdivisions
            .and_then(|subs| subs.into_iter().next())
            .and_then(|s| s.iso_code)
            .map(|s| s.to_string());
        // 0.28 replaced the freeform `Option<BTreeMap<&str, &str>>` of
        // `names` with a `Names` struct exposing named language fields.
        // We only ever use English (consistent with the rest of the
        // dashboard's i18n posture).
        let city_name = city
            .city
            .and_then(|c| c.names.english)
            .map(|s| s.to_string());

        // v1.1 chunk S1 — ASN enrichment runs as a separate lookup
        // against the optional ASN db. Failure here doesn't collapse
        // the whole lookup: if City matched but ASN didn't, we still
        // return Geo with `asn = None`.
        let (asn, asn_org) = self.lookup_asn(ip);

        country.map(|country| Geo {
            country,
            region,
            city: city_name,
            asn,
            asn_org,
        })
    }

    fn lookup_asn(&self, ip: IpAddr) -> (Option<u32>, Option<String>) {
        let Some(reader) = &self.asn_reader else {
            return (None, None);
        };
        let result = match reader.lookup(ip) {
            Ok(r) => r,
            Err(_) => return (None, None),
        };
        let asn = match result.decode::<AsnLite<'_>>() {
            Ok(Some(a)) => a,
            _ => return (None, None),
        };
        (asn.autonomous_system_number, asn.autonomous_system_organization.map(|s| s.to_string()))
    }
}

/// v1.1 chunk S1 — minimal slice of `geoip2::Asn` we care about.
/// Defined separately so a missing ASN field doesn't blow up the
/// whole parse.
#[derive(Deserialize)]
struct AsnLite<'a> {
    #[serde(rename = "autonomous_system_number")]
    autonomous_system_number: Option<u32>,
    #[serde(borrow, rename = "autonomous_system_organization")]
    autonomous_system_organization: Option<&'a str>,
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
