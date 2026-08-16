import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Nav } from "./components/Nav";
import { PitchTexture } from "./components/PitchTexture";
import { PageTransition } from "./components/PageTransition";
import { Explore } from "./pages/Explore";
import { Matches } from "./pages/Matches";
import { MatchDetail } from "./pages/MatchDetail";
import { Players } from "./pages/Players";
import { PlayerDetail } from "./pages/PlayerDetail";
import { Teams } from "./pages/Teams";
import { Tactics } from "./pages/Tactics";
import { TacticDetail } from "./pages/TacticDetail";
import { Compare } from "./pages/Compare";

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Explore /></PageTransition>} />
        <Route path="/matches" element={<PageTransition><Matches /></PageTransition>} />
        <Route path="/matches/:matchId" element={<PageTransition><MatchDetail /></PageTransition>} />
        <Route path="/players" element={<PageTransition><Players /></PageTransition>} />
        <Route path="/players/:playerId" element={<PageTransition><PlayerDetail /></PageTransition>} />
        <Route path="/teams" element={<PageTransition><Teams /></PageTransition>} />
        <Route path="/tactics" element={<PageTransition><Tactics /></PageTransition>} />
        <Route path="/tactics/:slug" element={<PageTransition><TacticDetail /></PageTransition>} />
        <Route path="/compare" element={<PageTransition><Compare /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PitchTexture />
      <Nav />
      <main>
        <AnimatedRoutes />
      </main>
    </BrowserRouter>
  );
}
