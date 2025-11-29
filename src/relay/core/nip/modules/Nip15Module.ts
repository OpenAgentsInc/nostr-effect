import { createModule, type NipModule } from "../NipModule.js"

export const Nip15Module: NipModule = createModule({
  id: "nip-15",
  nips: [15],
  description: "Marketplace kinds (30017/30018/30019/30020) and bid kinds (1021/1022).",
  kinds: [30017, 30018, 30019, 30020, 1021, 1022],
})

