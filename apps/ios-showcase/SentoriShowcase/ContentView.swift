import SwiftUI

/// Top-level showcase surface.
///
/// One long scroll. Hero, KPI strip, demo grid, replay ring,
/// recent events. No tabs, no navigation rail — the demo is a
/// single editorial page that scrolls top-to-bottom, like a Linear
/// changelog or a Vercel landing.
struct ContentView: View {
    @Environment(SentoriService.self) private var sentori

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                HeroSection()
                KPIRow()
                ActionGrid()
                ReplayRingPanel()
                EventLog()
                FooterCredits()
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
        .background(
            ZStack {
                SentoriPalette.paper.ignoresSafeArea()
                BackdropAura()
                    .ignoresSafeArea()
            }
        )
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
        .environment(SentoriService())
}

/// A faint, off-centre radial of accent + cool indigo — gives the
/// dark backdrop depth without competing with content. Static; no
/// performance cost.
private struct BackdropAura: View {
    var body: some View {
        ZStack {
            RadialGradient(
                colors: [SentoriPalette.accent.opacity(0.18), .clear],
                center: .topTrailing,
                startRadius: 60,
                endRadius: 360,
            )
            RadialGradient(
                colors: [Color(red: 0.235, green: 0.184, blue: 0.412).opacity(0.4), .clear],
                center: UnitPoint(x: 0.1, y: 0.85),
                startRadius: 80,
                endRadius: 420,
            )
        }
        .blendMode(.plusLighter)
        .opacity(0.55)
    }
}

/// Footer — keeps the page from feeling like it just ended.
private struct FooterCredits: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("SENTORI · IOS SHOWCASE")
                .font(SentoriType.mono(10, weight: .medium))
                .tracking(2.2)
                .foregroundStyle(SentoriPalette.inkMuted)
            Text("Errors, traces, and intent — at the speed of triage.")
                .font(SentoriType.body(13))
                .foregroundStyle(SentoriPalette.inkSoft)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 12)
    }
}
