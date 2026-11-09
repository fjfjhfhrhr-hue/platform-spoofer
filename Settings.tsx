import { React, ReactNative as RN } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";

const { ScrollView } = findByProps("ScrollView");
const { TableRadioGroup, TableRadioRow, Stack } = findByProps(
    "TableRadioGroup",
    "TableRadioRow",
    "Stack"
);

const socketModule = findByProps("getSocket", "isConnected");

// Helper to safely render asset icons with color tinting
function renderIcon(name: string, tintColor?: string) {
    const assetId = getAssetIDByName(name);
    if (!assetId) return null;

    return (
        <RN.Image
            source={assetId}
            style={{
                width: 24,
                height: 24,
                ...(tintColor ? { tintColor } : {}),
            }}
        />
    );
}

const PLATFORMS = [
    {
        label: "Off",
        value: "off",
        subLabel: "Default mobile status",
        icon: () => renderIcon("MobilePhoneIcon"),
    },
    {
        label: "Desktop",
        value: "desktop",
        subLabel: "Shows as Discord Desktop (Windows)",
        icon: () => renderIcon("ic_monitor", "#ffffff"),
    },
    {
        label: "Web / Browser",
        value: "web",
        subLabel: "Shows as Chrome on Windows",
        icon: () => renderIcon("GlobeEarthIcon"),
    },
    {
        label: "Meta Quest (VR)",
        value: "meta",
        subLabel: "Shows as Discord VR on Quest 2",
        icon: () => renderIcon("ic_vr_headset_24px"),
    },
    {
        label: "PlayStation 5",
        value: "console",
        subLabel: "Shows as PlayStation 5",
        icon: () => renderIcon("ic_playstation_device_ps5_32px"),
    },
];

export default function Settings() {
    useProxy(storage);
    const selected = storage.platform || "off";

    const handleSelect = (value: string) => {
        storage.platform = value;
        // Force reconnect to apply new platform
        const socket = socketModule?.getSocket();
        if (socket) {
            socket.sessionId = null;
            socket.seq = 0;
            if (socket.webSocket) {
                socket.webSocket.close();
            } else if (typeof socket.close === "function") {
                socket.close();
            }
        }
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
            <Stack spacing={16}>
                <TableRadioGroup
                    title="Select a platform to spoof"
                    value={selected}
                    onChange={(val: string) => handleSelect(val)}
                >
                    {PLATFORMS.map((opt) => (
                        <TableRadioRow
                            key={opt.value}
                            label={opt.label}
                            subLabel={opt.subLabel}
                            value={opt.value}
                            selected={selected === opt.value}
                            icon={opt.icon ? opt.icon() : undefined}
                            onPress={() => handleSelect(opt.value)}
                        />
                    ))}
                </TableRadioGroup>
            </Stack>
        </ScrollView>
    );
}