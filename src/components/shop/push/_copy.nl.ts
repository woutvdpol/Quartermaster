import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { pushUiCopy } from "./_copy";

export const pushUiCopyNl: CopyShape<typeof pushUiCopy> = {
  choice: {
    title: "Zoekopdracht bewaard",
    question: (name: string) => `“${name}” — hoe wilt u horen over nieuwe stukken?`,
    pushLabel: "Pushmelding op deze telefoon",
    pushHint: "Binnen een minuut na plaatsing. Unieke stukken zijn snel weg.",
    emailLabel: "E-mail",
    emailHint: {
      INSTANT: "Direct, één e-mail per nieuw item.",
      DAILY: "Eén keer per dag, alle nieuwe resultaten samen.",
      WEEKLY: "Eén keer per week (maandag), alle nieuwe resultaten samen.",
    },
    turnOn: "Pushmeldingen aanzetten",
    keepEmail: "E-mail houden",
    working: "Aanzetten…",
    pushOn: "Pushmeldingen staan aan. We sturen dit apparaat een melding zodra een nieuw stuk overeenkomt.",
    emailKept: "We mailen u over nieuwe stukken.",
  },
  ios: {
    title: "Zet de shop eerst op uw beginscherm",
    intro: "Op de iPhone werken pushmeldingen alleen vanuit de app op het beginscherm:",
    steps: [
      "Tik in Safari op de deelknop.",
      "Kies „Zet op beginscherm”.",
      "Open de shop vanaf uw beginscherm, log in en zet push aan onder Account › Meldingen.",
    ],
    hint: "iPhone: zet de shop eerst op uw beginscherm (Deel › Zet op beginscherm). We laten u zien hoe.",
  },
  denied: "Meldingen zijn geblokkeerd voor deze site. Sta ze toe in uw browserinstellingen en probeer het opnieuw.",
  unsupported: "Deze browser kan geen pushmeldingen ontvangen. We blijven u e-mailen.",
  error: "Er ging iets mis. Probeer het opnieuw.",
  loginAgain: "Log opnieuw in.",
  close: "Sluiten",
  settings: {
    title: "Pushmeldingen",
    intro: "Push werkt op Android, in desktopbrowsers en op de iPhone (vanuit de app op het beginscherm). Geen app store nodig.",
    thisDeviceOn: "Push staat aan op dit apparaat.",
    thisDeviceOff: "Push staat uit op dit apparaat.",
    otherDevices: (n: number) => (n === 1 ? "1 apparaat ontvangt pushmeldingen." : `${n.toLocaleString("nl-NL")} apparaten ontvangen pushmeldingen.`),
    turnOn: "Push aanzetten op dit apparaat",
    turnOff: "Push uitzetten op dit apparaat",
    wishlist: "Prijsverlagingen op uw verlanglijst",
    reservation: "Reservering loopt af (ongeveer 3 minuten voordat uw winkelwagen wordt vrijgegeven)",
    quiet: "Stille uren",
    quietOff: "Geen",
    quietHint: "Meldingen wachten tot de ochtend. Waarschuwingen over reserveringen vervallen.",
    max: "Maximaal",
    maxOption: (n: number) => (n === 1 ? "1 pushmelding per dag" : `${n.toLocaleString("nl-NL")} pushmeldingen per dag`),
    saved: "Opgeslagen.",
  },
  delivery: {
    label: "Bezorgen via",
    push: "Pushmelding (direct)",
  },
};
