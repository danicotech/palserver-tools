// 玩家頭像名冊的 React context：載入共用名冊，提供「依玩家名取頭像」給全站各處連動使用。
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { getRoster } from "./api";
import { palInfo } from "./paldex";

interface RosterCtxValue {
  /** 該玩家設定的頭像 URL；未設定回 undefined（呼叫端自行 fallback）。 */
  avatarUrlFor: (name: string) => string | undefined;
  /** 該玩家設定的帕魯代號；未設定回 undefined。 */
  palIdFor: (name: string) => string | undefined;
  /** 重新抓名冊（設定後呼叫，讓各處即時連動）。 */
  refresh: () => void;
}

const Ctx = createContext<RosterCtxValue>({
  avatarUrlFor: () => undefined,
  palIdFor: () => undefined,
  refresh: () => {},
});

export function useRoster(): RosterCtxValue {
  return useContext(Ctx);
}

const norm = (s: string) => s.trim().toLowerCase();

export function RosterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [map, setMap] = useState<Map<string, string>>(new Map()); // normalize(name) -> palId

  const refresh = useCallback(() => {
    getRoster().then((list) => {
      if (!list) return;
      const m = new Map<string, string>();
      for (const e of list) m.set(norm(e.name), e.palId);
      setMap(m);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const palIdFor = useCallback((name: string) => map.get(norm(name)), [map]);
  const avatarUrlFor = useCallback(
    (name: string) => {
      const id = map.get(norm(name));
      return id ? palInfo(id).iconUrl : undefined;
    },
    [map],
  );

  return <Ctx.Provider value={{ avatarUrlFor, palIdFor, refresh }}>{children}</Ctx.Provider>;
}
