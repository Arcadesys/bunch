export type CoverageStatus = "DRAFT" | "CONFIRMED" | "REJECTED";

export type PrivateImage = {
  id: string;
  storageKey: string;
  contentType: string;
  isProfilePicture: boolean;
  createdAt: string;
};

export type AlterProfile = {
  pronouns?: string;
  species?: string;
  visualDescription?: string;
  presentation?: string;
  signatureTraits?: string[];
  styleTags?: string[];
  imageDoNotChange?: string[];
  id: string;
  ownerId: string;
  name: string;
  selfDescribedGender?: string;
  description?: string;
  profilePicture?: PrivateImage;
  images: PrivateImage[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CoverageAssignment = {
  id: string;
  ownerId: string;
  alterId?: string;
  startsOn: string;
  endsOn?: string;
  status: CoverageStatus;
  reasons: string[];
  createdAt: string;
  confirmedAt?: string;
};

export type ConfirmedCoverage = Omit<Pick<CoverageAssignment, "id" | "alterId" | "startsOn" | "endsOn">, "alterId"> & {
  alterId: string;
  alterName: string;
};

export type SystemNote = {
  id: string;
  ownerId: string;
  body: string;
  alterId?: string;
  coverageId?: string;
  actorAlterId?: string;
  createdAt: string;
};

export type SystemTodo = {
  id: string;
  ownerId: string;
  title: string;
  alterId?: string;
  coverageId?: string;
  status: "OPEN" | "DONE";
  createdAt: string;
};

export type SystemPreference = {
  key: string;
  value: string;
  updatedAt: string;
};
