import { describe, expect, it } from "vitest";
import { appendSorted, sortByFilename } from "./order";

describe("source ordering", () => {
  it("sorts filenames naturally and without case sensitivity", () => {
    const files = [
      { name: "face_10.png" },
      { name: "Face_02.png" },
      { name: "face_1.png" },
    ];

    expect(sortByFilename(files).map((file) => file.name)).toEqual([
      "face_1.png",
      "Face_02.png",
      "face_10.png",
    ]);
  });

  it("keeps the existing custom order when appending a sorted batch", () => {
    const current = [{ name: "custom-b.png" }, { name: "custom-a.png" }];
    const incoming = [{ name: "new_10.png" }, { name: "new_2.png" }];

    expect(appendSorted(current, incoming).map((file) => file.name)).toEqual([
      "custom-b.png",
      "custom-a.png",
      "new_2.png",
      "new_10.png",
    ]);
  });
});
