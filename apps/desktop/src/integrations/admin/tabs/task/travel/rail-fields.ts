import type { Transportation, TransportationType } from "../../../../productivity/travel-v2/types";

export type TransportationFieldKey =
  | "name"
  | "transportationType"
  | "serviceNumber"
  | "operator"
  | "vehicleModel"
  | "aircraftRegistration"
  | "licensePlate"
  | "carriage"
  | "seat"
  | "departureName"
  | "arrivalName"
  | "departureCode"
  | "arrivalCode"
  | "departureTerminal"
  | "arrivalTerminal"
  | "departureGate"
  | "arrivalGate"
  | "note";

export type FieldDef = { key: TransportationFieldKey; label: string };

const FLIGHT: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "飞机" },
  { key: "serviceNumber", label: "航班号" },
  { key: "operator", label: "航空公司" },
  { key: "vehicleModel", label: "机型" },
  { key: "aircraftRegistration", label: "飞机注册号" },
  { key: "seat", label: "座位" },
  { key: "departureName", label: "出发机场" },
  { key: "arrivalName", label: "到达机场" },
  { key: "departureCode", label: "出发三字码" },
  { key: "arrivalCode", label: "到达三字码" },
  { key: "departureTerminal", label: "航站楼" },
  { key: "arrivalTerminal", label: "到达航站楼" },
  { key: "departureGate", label: "登机口" },
  { key: "arrivalGate", label: "到达口" },
  { key: "note", label: "备注" },
];

const TRAIN: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "火车" },
  { key: "serviceNumber", label: "车次" },
  { key: "operator", label: "客运段" },
  { key: "vehicleModel", label: "车型" },
  { key: "carriage", label: "车厢" },
  { key: "seat", label: "座位" },
  { key: "departureName", label: "出发站" },
  { key: "arrivalName", label: "到达站" },
  { key: "departureGate", label: "检票口" },
  { key: "note", label: "备注" },
];

const BUS: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "公交" },
  { key: "serviceNumber", label: "线路" },
  { key: "operator", label: "公交公司" },
  { key: "vehicleModel", label: "车型" },
  { key: "licensePlate", label: "车牌" },
  { key: "seat", label: "座位" },
  { key: "departureName", label: "出发站点" },
  { key: "arrivalName", label: "到达站点" },
  { key: "departureGate", label: "上车口" },
  { key: "note", label: "备注" },
];

const METRO: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "地铁" },
  { key: "serviceNumber", label: "线路" },
  { key: "operator", label: "运营公司" },
  { key: "vehicleModel", label: "车型" },
  { key: "seat", label: "座位" },
  { key: "departureName", label: "出发站" },
  { key: "arrivalName", label: "到达站" },
  { key: "note", label: "备注" },
];

const FERRY: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "轮渡" },
  { key: "serviceNumber", label: "航次" },
  { key: "operator", label: "船公司" },
  { key: "vehicleModel", label: "船型" },
  { key: "seat", label: "座位／铺位" },
  { key: "departureName", label: "出发港" },
  { key: "arrivalName", label: "到达港" },
  { key: "note", label: "备注" },
];

const CAR: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "驾车" },
  { key: "vehicleModel", label: "车型" },
  { key: "licensePlate", label: "车牌" },
  { key: "departureName", label: "出发地" },
  { key: "arrivalName", label: "目的地" },
  { key: "note", label: "备注" },
];

const GENERIC: FieldDef[] = [
  { key: "name", label: "名称" },
  { key: "transportationType", label: "类型" },
  { key: "note", label: "备注" },
];

export function fieldsForTransportationType(type: TransportationType | null): FieldDef[] {
  switch (type) {
    case "flight":
      return FLIGHT;
    case "train":
      return TRAIN;
    case "bus":
      return BUS;
    case "metro":
      return METRO;
    case "ferry":
      return FERRY;
    case "car":
      return CAR;
    default:
      return GENERIC;
  }
}

export function readTransportationField(transport: Transportation, key: TransportationFieldKey): string {
  if (key === "transportationType") {
    return transport.transportationType ?? "";
  }
  const raw = transport[key as keyof Transportation];
  return typeof raw === "string" ? raw : "";
}
