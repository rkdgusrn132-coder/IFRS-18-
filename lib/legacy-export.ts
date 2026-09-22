import ExcelJS from "exceljs";

export const runtime = "nodejs";

type ExportEvidenceTable = {
  note_number: string;
  note_title: string;
  unit: string | null;
  rows: {
    text: string;
    row_span: number;
    col_span: number;
    header: boolean;
  }[][];
};

type ExportEvidence = {
  review_reason: string;

  amount_evidence:
    | ExportEvidenceTable
    | null;

  classification_evidence:
    | ExportEvidenceTable
    | null;

  contextual_evidence:
    | {
        note_number: string;
        note_title: string;
        text: string;
      }
    | null;
};

type ExportRow = {
  category: string;
  account: string;

  current_amount:
    | number
    | null;

  prior_amount:
    | number
    | null;

  note_number: string;

  ifrs18_status: string;

  classification_driver:
    | string
    | null;

  next_action:
    | string
    | null;

  decision: {
    classification:
      | string
      | null;

    memo: string;
  };

  evidence:
    | ExportEvidence
    | null;
};

type ExportRequest = {
  analysis: {
    company: string;
    corp_code: string;
    year: string;
    statement_type: string;

    report: {
      report_name: string;
      rcept_no: string;
      rcept_date: string;
    };

    finance_note: {
      note_number: string;
      note_title: string;
      unit: string;
    };
  };

  rows: ExportRow[];
};

function sanitizeFileName(
  value: string
) {
  return value
    .replace(
      /[\\/:*?"<>|]/g,
      "_"
    )
    .trim();
}

function applyThinBorder(
  cell: ExcelJS.Cell
) {
  cell.border = {
    top: {
      style: "thin",
      color: {
        argb: "FFD1D5DB",
      },
    },

    left: {
      style: "thin",
      color: {
        argb: "FFD1D5DB",
      },
    },

    bottom: {
      style: "thin",
      color: {
        argb: "FFD1D5DB",
      },
    },

    right: {
      style: "thin",
      color: {
        argb: "FFD1D5DB",
      },
    },
  };
}

function styleHeaderRow(
  row: ExcelJS.Row
) {
  row.height = 28;

  row.eachCell(
    (cell) => {
      cell.font = {
        bold: true,
        color: {
          argb: "FFFFFFFF",
        },
      };

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FF1F2937",
        },
      };

      cell.alignment = {
        vertical:
          "middle",
        horizontal:
          "center",
        wrapText: true,
      };

      applyThinBorder(
        cell
      );
    }
  );
}

function styleDataArea(
  worksheet:
    ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number
) {
  for (
    let rowNumber =
      startRow;
    rowNumber <=
    endRow;
    rowNumber++
  ) {
    const row =
      worksheet.getRow(
        rowNumber
      );

    for (
      let column =
        startColumn;
      column <=
      endColumn;
      column++
    ) {
      const cell =
        row.getCell(
          column
        );

      applyThinBorder(
        cell
      );

      cell.alignment = {
        vertical:
          "top",
        wrapText: true,
      };
    }
  }
}

function setClassificationStyle(
  cell: ExcelJS.Cell,
  classification: string
) {
  cell.alignment = {
    horizontal:
      "center",
    vertical:
      "middle",
  };

  cell.font = {
    bold: true,
  };

  let fill =
    "FFF3F4F6";

  if (
    classification ===
    "영업"
  ) {
    fill =
      "FFDCFCE7";
  }

  if (
    classification ===
    "투자"
  ) {
    fill =
      "FFDBEAFE";
  }

  if (
    classification ===
    "재무"
  ) {
    fill =
      "FFFFEDD5";
  }

  if (
    classification ===
    "추가검토"
  ) {
    fill =
      "FFFEF3C7";
  }

  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: fill,
    },
  };
}

function tableToText(
  rows:
    ExportEvidenceTable["rows"]
) {
  return rows
    .map((row) =>
      row
        .map(
          (cell) =>
            cell.text
        )
        .filter(
          (text) =>
            text !== ""
        )
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

export async function POST(
  request: Request
) {
  try {
    const body =
      (await request.json()) as ExportRequest;

    const analysis =
      body.analysis;

    const rows =
      Array.isArray(
        body.rows
      )
        ? body.rows
        : [];

    if (
      !analysis ||
      !analysis.company
    ) {
      return Response.json(
        {
          error:
            "내보낼 분석 정보가 없습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const workbook =
      new ExcelJS.Workbook();

    workbook.creator =
      "IFRS 18 Data Review";

    workbook.company =
      analysis.company;

    workbook.created =
      new Date();

    workbook.modified =
      new Date();

    workbook.calcProperties.fullCalcOnLoad =
      true;

    /*
      =================================
      Sheet 1. Summary
      =================================
    */

    const summary =
      workbook.addWorksheet(
        "Summary",
        {
          views: [
            {
              state:
                "frozen",
              ySplit: 2,
            },
          ],
        }
      );

    summary.mergeCells(
      "A1:F1"
    );

    const title =
      summary.getCell(
        "A1"
      );

    title.value =
      "IFRS 18 검토조서";

    title.font = {
      bold: true,
      size: 18,
      color: {
        argb: "FFFFFFFF",
      },
    };

    title.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF111827",
      },
    };

    title.alignment = {
      vertical:
        "middle",
      horizontal:
        "left",
    };

    summary.getRow(
      1
    ).height = 34;

    const summaryInfo = [
      [
        "대상 회사",
        analysis.company,
      ],

      [
        "DART 고유번호",
        analysis.corp_code,
      ],

      [
        "사업연도",
        analysis.year,
      ],

      [
        "재무제표",
        analysis.statement_type,
      ],

      [
        "사업보고서",
        analysis.report
          .report_name,
      ],

      [
        "접수번호",
        analysis.report
          .rcept_no,
      ],

      [
        "금융수익·비용 주석",
        `주석 ${analysis.finance_note.note_number} · ${analysis.finance_note.note_title}`,
      ],

      [
        "금액 단위",
        analysis.finance_note
          .unit,
      ],
    ];

    let summaryRow = 3;

    for (
      const item of
      summaryInfo
    ) {
      const label =
        summary.getCell(
          summaryRow,
          1
        );

      const value =
        summary.getCell(
          summaryRow,
          2
        );

      label.value =
        item[0];

      value.value =
        item[1];

      label.font = {
        bold: true,
      };

      label.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FFF3F4F6",
        },
      };

      label.alignment = {
        vertical:
          "middle",
      };

      value.alignment = {
        vertical:
          "middle",
        wrapText: true,
      };

      applyThinBorder(
        label
      );

      applyThinBorder(
        value
      );

      summaryRow++;
    }

    summaryRow += 1;

    summary.getCell(
      summaryRow,
      1
    ).value =
      "검토 진행 현황";

    summary.getCell(
      summaryRow,
      1
    ).font = {
      bold: true,
      size: 13,
    };

    summaryRow++;

    const statusStartRow =
      summaryRow;

    const statusData = [
      [
        "항목",
        "계정 수",
      ],

      [
        "전체 검토대상",
        0,
      ],

      [
        "분류 입력 완료",
        0,
      ],

      [
        "영업",
        0,
      ],

      [
        "투자",
        0,
      ],

      [
        "재무",
        0,
      ],

      [
        "추가검토",
        0,
      ],

      [
        "미분류",
        0,
      ],

      [
        "근거 조회 완료",
        0,
      ],
    ];

    for (
      const item of
      statusData
    ) {
      summary.addRow(
        item
      );
    }

    styleHeaderRow(
      summary.getRow(
        statusStartRow
      )
    );

    const reviewLastRow =
      rows.length + 1;

    const formulaRows = {
      total:
        statusStartRow +
        1,

      completed:
        statusStartRow +
        2,

      operating:
        statusStartRow +
        3,

      investing:
        statusStartRow +
        4,

      financing:
        statusStartRow +
        5,

      further:
        statusStartRow +
        6,

      unclassified:
        statusStartRow +
        7,

      evidence:
        statusStartRow +
        8,
    };

    summary.getCell(
      formulaRows.total,
      2
    ).value = {
      formula:
        `COUNTA('IFRS 18 Review'!B2:B${reviewLastRow})`,
    };

    summary.getCell(
      formulaRows.completed,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"<>미분류")`,
    };

    summary.getCell(
      formulaRows.operating,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"영업")`,
    };

    summary.getCell(
      formulaRows.investing,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"투자")`,
    };

    summary.getCell(
      formulaRows.financing,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"재무")`,
    };

    summary.getCell(
      formulaRows.further,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"추가검토")`,
    };

    summary.getCell(
      formulaRows.unclassified,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!H2:H${reviewLastRow},"미분류")`,
    };

    summary.getCell(
      formulaRows.evidence,
      2
    ).value = {
      formula:
        `COUNTIF('IFRS 18 Review'!L2:L${reviewLastRow},"조회 완료")`,
    };

    styleDataArea(
      summary,
      statusStartRow + 1,
      statusStartRow + 8,
      1,
      2
    );

    summary.columns = [
      {
        width: 24,
      },
      {
        width: 50,
      },
      {
        width: 12,
      },
      {
        width: 12,
      },
      {
        width: 12,
      },
      {
        width: 12,
      },
    ];

    /*
      =================================
      Sheet 2. IFRS 18 Review
      =================================
    */

    const review =
      workbook.addWorksheet(
        "IFRS 18 Review",
        {
          views: [
            {
              state:
                "frozen",
              ySplit: 1,
              xSplit: 2,
            },
          ],
        }
      );

    const reviewHeaders = [
      "구분",
      "계정",
      "당기",
      "전기",
      "단위",
      "DART 주석",
      "검토 상태",
      "IFRS 18 분류",
      "분류 검토 포인트",
      "다음 검토",
      "검토 메모",
      "근거 조회",
    ];

    review.addRow(
      reviewHeaders
    );

    styleHeaderRow(
      review.getRow(1)
    );

    for (
      const item of rows
    ) {
      const classification =
        item.decision
          .classification ??
        "미분류";

      const evidenceStatus =
        item.evidence
          ? "조회 완료"
          : "미조회";

      const row =
        review.addRow([
          item.category,
          item.account,
          item.current_amount,
          item.prior_amount,
          analysis.finance_note
            .unit,
          `주석 ${item.note_number}`,
          item.ifrs18_status,
          classification,
          item.classification_driver ??
            "",
          item.next_action ??
            "",
          item.decision.memo,
          evidenceStatus,
        ]);

      row.alignment = {
        vertical:
          "top",
      };

      row.getCell(
        3
      ).numFmt =
        '#,##0;[Red](#,##0)';

      row.getCell(
        4
      ).numFmt =
        '#,##0;[Red](#,##0)';

      setClassificationStyle(
        row.getCell(8),
        classification
      );

      if (
        evidenceStatus ===
        "조회 완료"
      ) {
        row.getCell(
          12
        ).fill = {
          type:
            "pattern",
          pattern:
            "solid",
          fgColor: {
            argb:
              "FFDCFCE7",
          },
        };
      }
    }

    if (
      rows.length > 0
    ) {
      styleDataArea(
        review,
        2,
        reviewLastRow,
        1,
        12
      );

      review.autoFilter = {
        from: {
          row: 1,
          column: 1,
        },

        to: {
          row: reviewLastRow,
          column: 12,
        },
      };

      review.getCell(
        `H2`
      ).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          '"영업,투자,재무,법인세,중단영업,추가검토,미분류"',
        ],
      };

      for (
        let rowNumber = 2;
        rowNumber <=
        reviewLastRow;
        rowNumber++
      ) {
        review.getCell(
          rowNumber,
          8
        ).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [
            '"영업,투자,재무,법인세,중단영업,추가검토,미분류"',
          ],
        };
      }
    }

    review.columns = [
      {
        width: 16,
      },

      {
        width: 28,
      },

      {
        width: 16,
      },

      {
        width: 16,
      },

      {
        width: 10,
      },

      {
        width: 14,
      },

      {
        width: 14,
      },

      {
        width: 16,
      },

      {
        width: 38,
      },

      {
        width: 36,
      },

      {
        width: 45,
      },

      {
        width: 14,
      },
    ];

    /*
      =================================
      Sheet 3. Evidence
      =================================
    */

    const evidence =
      workbook.addWorksheet(
        "Evidence",
        {
          views: [
            {
              state:
                "frozen",
              ySplit: 1,
              xSplit: 2,
            },
          ],
        }
      );

    const evidenceHeaders = [
      "구분",
      "계정",
      "당기",
      "근거 유형",
      "주석",
      "주석명",
      "단위",
      "검토 목적",
      "근거 내용",
    ];

    evidence.addRow(
      evidenceHeaders
    );

    styleHeaderRow(
      evidence.getRow(
        1
      )
    );

    for (
      const item of rows
    ) {
      const evidenceData =
        item.evidence;

      if (
        !evidenceData
      ) {
        evidence.addRow([
          item.category,
          item.account,
          item.current_amount,
          "미조회",
          "",
          "",
          analysis.finance_note
            .unit,
          "",
          "웹앱에서 해당 계정을 클릭하여 근거 조회 후 다시 내보내세요.",
        ]);

        continue;
      }

      if (
        evidenceData
          .amount_evidence
      ) {
        evidence.addRow([
          item.category,
          item.account,
          item.current_amount,
          "금액 확인",
          `주석 ${evidenceData.amount_evidence.note_number}`,
          evidenceData
            .amount_evidence
            .note_title,
          evidenceData
            .amount_evidence
            .unit ??
            analysis.finance_note
              .unit,
          evidenceData
            .review_reason,
          tableToText(
            evidenceData
              .amount_evidence
              .rows
          ),
        ]);
      }

      if (
        evidenceData
          .classification_evidence
      ) {
        evidence.addRow([
          item.category,
          item.account,
          item.current_amount,
          "발생원천 분해",
          `주석 ${evidenceData.classification_evidence.note_number}`,
          evidenceData
            .classification_evidence
            .note_title,
          evidenceData
            .classification_evidence
            .unit ??
            analysis.finance_note
              .unit,
          evidenceData
            .review_reason,
          tableToText(
            evidenceData
              .classification_evidence
              .rows
          ),
        ]);
      }

      if (
        evidenceData
          .contextual_evidence
      ) {
        evidence.addRow([
          item.category,
          item.account,
          item.current_amount,
          "관련 설명",
          `주석 ${evidenceData.contextual_evidence.note_number}`,
          evidenceData
            .contextual_evidence
            .note_title,
          "",
          evidenceData
            .review_reason,
          evidenceData
            .contextual_evidence
            .text,
        ]);
      }
    }

    const evidenceLastRow =
      evidence.rowCount;

    if (
      evidenceLastRow >
      1
    ) {
      styleDataArea(
        evidence,
        2,
        evidenceLastRow,
        1,
        9
      );

      for (
        let rowNumber = 2;
        rowNumber <=
        evidenceLastRow;
        rowNumber++
      ) {
        const row =
          evidence.getRow(
            rowNumber
          );

        row.getCell(
          3
        ).numFmt =
          '#,##0;[Red](#,##0)';

        row.getCell(
          9
        ).alignment = {
          vertical:
            "top",
          wrapText: true,
        };

        const type =
          String(
            row.getCell(
              4
            ).value ?? ""
          );

        if (
          type ===
          "금액 확인"
        ) {
          row.getCell(
            4
          ).fill = {
            type:
              "pattern",
            pattern:
              "solid",
            fgColor: {
              argb:
                "FFDCFCE7",
            },
          };
        }

        if (
          type ===
          "발생원천 분해"
        ) {
          row.getCell(
            4
          ).fill = {
            type:
              "pattern",
            pattern:
              "solid",
            fgColor: {
              argb:
                "FFDBEAFE",
            },
          };
        }

        if (
          type ===
          "관련 설명"
        ) {
          row.getCell(
            4
          ).fill = {
            type:
              "pattern",
            pattern:
              "solid",
            fgColor: {
              argb:
                "FFF3F4F6",
            },
          };
        }
      }

      evidence.autoFilter = {
        from: {
          row: 1,
          column: 1,
        },

        to: {
          row:
            evidenceLastRow,
          column: 9,
        },
      };
    }

    evidence.columns = [
      {
        width: 16,
      },

      {
        width: 28,
      },

      {
        width: 16,
      },

      {
        width: 18,
      },

      {
        width: 14,
      },

      {
        width: 34,
      },

      {
        width: 10,
      },

      {
        width: 40,
      },

      {
        width: 90,
      },
    ];

    /*
      워크북 생성
    */

    const buffer =
      await workbook.xlsx.writeBuffer();

    const fileName =
      sanitizeFileName(
        `IFRS18_${analysis.company}_${analysis.year}_${analysis.statement_type}.xlsx`
      );

    return new Response(
      new Uint8Array(
        buffer
      ),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          "Content-Disposition":
            `attachment; filename*=UTF-8''${encodeURIComponent(
              fileName
            )}`,
        },
      }
    );
  } catch (error) {
    console.error(
      error
    );

    return Response.json(
      {
        error:
          "Excel 검토조서 생성 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}