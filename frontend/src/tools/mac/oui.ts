import raw from "./oui.tsv?raw";
import { parseOuiList } from "./mac";

export const oui = () => parseOuiList(raw);
