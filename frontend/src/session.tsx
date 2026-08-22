import React, { createContext, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { api, Player } from "@/src/api";
import { registerForPush } from "@/src/push";

const KEY = "tus.currentPlayerId";
const TOKEN_KEY = "tus.token";
const PLAYER_KEY = "tus.currentPlayer";

type SessionCtx = {
  ready: boolean;
  player: Player | null;
  players: Player[];
  reloadPlayers: () => Promise<void>;
  login: (p: Player, token: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionCtx>(null as any);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

  const reloadPlayers = async () => {
    try {
      setPlayers(await api.players());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const savedId = await storage.getItem<string | null>(KEY, null);
        const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
        // Probe the token before trusting the cached player: this ensures a
        // revoked/expired token cannot resurrect the session.
        let tokenValid = false;
        if (savedId && token) {
          try {
            await api.me();
            tokenValid = true;
          } catch {
            tokenValid = false;
          }
        }
        if (!tokenValid) {
          await storage.secureRemove(TOKEN_KEY).catch(() => {});
          await storage.removeItem(KEY).catch(() => {});
          await storage.removeItem(PLAYER_KEY).catch(() => {});
          setPlayer(null);
          try {
            setPlayers(await api.players());
          } catch {}
          return;
        }
        const cached = await storage.getItem<string | null>(PLAYER_KEY, null);
        if (cached) {
          try {
            setPlayer(JSON.parse(cached) as Player);
          } catch {}
        }
        try {
          const list = await api.players();
          setPlayers(list);
          const found = list.find((p) => p.id === savedId);
          if (found) {
            setPlayer(found);
            await storage.setItem(PLAYER_KEY, JSON.stringify(found));
          }
        } catch {
          // offline: keep cached player if any
        }
      } catch {
        // ignore
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = async (p: Player, token: string) => {
    await storage.secureSet(TOKEN_KEY, token);
    await storage.setItem(KEY, p.id);
    await storage.setItem(PLAYER_KEY, JSON.stringify(p));
    setPlayer(p);
    registerForPush(p.id);
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(KEY);
    await storage.removeItem(PLAYER_KEY);
    setPlayer(null);
  };

  return (
    <Ctx.Provider value={{ ready, player, players, reloadPlayers, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
