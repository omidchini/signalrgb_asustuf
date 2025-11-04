import QtQuick 2.15
import QtQuick.Layouts 1.15

Item {
    anchors.fill: parent

    property bool initialized: false // updated from js after Initialize

    Column {
        width: parent.width
        spacing: 12

        Text { text: "ASUS TUF Radeon RX 7900 XTX"; color: theme.primarytextcolor; font.pixelSize: 22; font.family: theme.primaryfont }
        Text { text: initialized ? "Device detected" : "Waiting for detection"; color: initialized ? "#4CAF50" : "#FFC107" }

        Pane {
            width: 560; padding: 12
            background: Rectangle { color: theme.background2; radius: theme.radius }
            ColumnLayout { anchors.fill: parent; spacing: 10
                RowLayout { spacing: 16
                    ColumnLayout { spacing: 4
                        Text { text: "Safety"; color: theme.secondarytextcolor }
                        Switch { checked: EnableControl; onToggled: EnableControl = checked; text: "Enable Control" }
                        Text { text: EnableControl ? "Writes Active" : "Writes Disabled"; color: EnableControl? "#FF5252" : theme.secondarytextcolor; font.pixelSize: 12 }
                    }
                    ColumnLayout { spacing:4
                        Text { text: "Lighting Mode"; color: theme.secondarytextcolor }
                        ComboBox { Layout.preferredWidth:160; model:["Canvas","Forced"]; onCurrentTextChanged: LightingMode = currentText }
                    }
                    ColumnLayout { spacing:4
                        Text { text: "Forced Color"; color: theme.secondarytextcolor }
                        ColorPicker { id: forcedColorPicker; Layout.preferredWidth:160; onColorChanged: forcedColor = forcedColorPicker.color }
                    }
                    ColumnLayout { spacing:4
                        Text { text: "Brightness"; color: theme.secondarytextcolor }
                        Slider { from:0; to:255; value: Brightness; Layout.preferredWidth:160; onValueChanged: Brightness = value }
                    }
                }
                RowLayout { spacing: 16
                    ColumnLayout { spacing:4
                        Text { text: "Effect Mode"; color: theme.secondarytextcolor }
                        ComboBox { Layout.preferredWidth:180; model:["Direct","Static","Breathing","Flashing","Spectrum","Rainbow"]; onCurrentTextChanged: EffectMode = currentText }
                    }
                    ColumnLayout { spacing:4
                        Text { text: "Speed"; color: theme.secondarytextcolor }
                        Slider { from:0; to:255; value: EffectSpeed; Layout.preferredWidth:180; onValueChanged: EffectSpeed = value }
                    }
                    ColumnLayout { spacing:4
                        Text { text: "Direction"; color: theme.secondarytextcolor }
                        ComboBox { Layout.preferredWidth:140; model:["Forward","Reverse"]; onCurrentTextChanged: EffectDirection = currentText }
                    }
                }
                Text { text: "LED Count: " + LedCount + "  | Controller: " + deviceVersion; color: theme.secondarytextcolor }
            }
        }
        Text { text: "Warning: SMBus writes can damage hardware. Use at your own risk."; color: "#FF5252"; font.pixelSize: 14 }
    }
}
