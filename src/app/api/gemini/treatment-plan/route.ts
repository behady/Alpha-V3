import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Clinical AI planner has been removed from this system.",
      disabled: true,
    },
    { status: 410 }
  );
}
