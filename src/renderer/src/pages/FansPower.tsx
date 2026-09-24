import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  PPT_ATTRS,
  armouryMeta,
  sortProfiles,
  validateCurve,
  type CurveError,
  type FanCurve,
  type FanId
} from '@shared/asus'
import { attrDescription, attrLabel, profileName, type Translator } from '@shared/i18n'
import { useStore, useT } from '../store'
import { Button, Card, Note, Row, Segmented, Slider, Toggle } from '../ui'
import { FanCurveEditor } from '../components/FanCurveEditor'

type Edits = Partial<Record<FanId, { temp: number[]; pwm: number[] }>>

function curveErrorText(t: Translator, e: CurveError): string {
  if (e.code === 'count') return t('curve.count')
  const field = t(`curve.field.${e.field}`)
  return e.code === 'range'
    ? t('curve.range', { field, n: e.point })
    : t('curve.decreasing', { field, a: e.point - 1, b: e.point })
}

const fanName = (t: Translator, fan: string): string => t.dyn(`fan.${fan}`, fan)

export function FansPower(): ReactNode {
  const { snap } = useStore()
  const t = useT()
  const active = snap?.platform?.profile ?? 0
  const [profile, setProfile] = useState<number>(active)
  const [followActive, setFollowActive] = useState(true)

  // Follow Fn+F5 / tray changes until the user picks a profile explicitly.
  useEffect(() => {
    if (followActive) setProfile(active)
  }, [active, followActive])

  if (!snap?.platform) return null
  return (
    <div className="grid">
      <Card title={t('fans.profileTitle')} icon="bolt" className="span-2">
        <Segmented
          label={t('fans.profileTitle')}
          value={profile}
          options={sortProfiles(snap.platform.choices).map((c) => ({
            value: c,
            label: (
              <>
                {profileName(t, c)}
                {c === active && <span className="dot" title={t('fans.activeNow')} />}
              </>
            )
          }))}
          onChange={(v) => {
            setProfile(v)
            setFollowActive(v === active)
          }}
        />
        <p className="muted small">{t('fans.profileNote')}</p>
      </Card>
      <FanCard profile={profile} isActive={profile === active} />
      <PowerCard profile={profile} isActive={profile === active} />
    </div>
  )
}

function FanCard({ profile, isActive }: { profile: number; isActive: boolean }): ReactNode {
  const { snap, act, busy, sensors } = useStore()
  const t = useT()
  const [curves, setCurves] = useState<FanCurve[] | null>(null)
  const [edits, setEdits] = useState<Edits>({})
  const [fan, setFan] = useState<FanId>('CPU')
  const [unsupported, setUnsupported] = useState(false)

  const load = useCallback(async () => {
    const c = await window.asus.action<FanCurve[]>({ type: 'getFanCurves', profile }).catch(() => null)
    setUnsupported(c === null)
    setCurves(c)
  }, [profile])

  // Reload on profile switch, and whenever asusd pushes new state for the active profile.
  useEffect(() => {
    setEdits({})
    void load()
  }, [load])
  useEffect(() => {
    if (isActive && snap?.fans) setCurves(snap.fans)
  }, [isActive, snap?.fans])

  if (unsupported) {
    return (
      <Card title={t('fans.title')} icon="fan" className="span-2">
        <p className="muted">{t('fans.unsupported')}</p>
      </Card>
    )
  }
  if (!curves) {
    return (
      <Card title={t('fans.title')} icon="fan" className="span-2">
        <p className="muted">{t('fans.loading')}</p>
      </Card>
    )
  }

  const current = curves.find((c) => c.fan === fan) ?? curves[0]
  const edited = edits[current.fan] ?? current
  const enabled = curves.some((c) => c.enabled)
  const dirtyFans = (Object.keys(edits) as FanId[]).filter((f) => {
    const c = curves.find((x) => x.fan === f)
    return c && (c.temp.join() !== edits[f]!.temp.join() || c.pwm.join() !== edits[f]!.pwm.join())
  })
  const error = validateCurve(edited)
  const liveTemp =
    current.fan === 'CPU'
      ? sensors?.cpuTemp
      : sensors?.dgpu === 'active'
        ? sensors.dgpuTemp
        : sensors?.igpuTemp

  const apply = async (): Promise<void> => {
    for (const f of dirtyFans) {
      const base = curves.find((c) => c.fan === f)!
      // Saving a custom curve implies wanting it active, as in G-Helper.
      await act({ type: 'setFanCurve', profile, curve: { ...base, ...edits[f]!, enabled: true } })
    }
    setEdits({})
    await load()
  }

  return (
    <Card
      title={t('fans.title')}
      icon="fan"
      className="span-2"
      actions={
        <>
          <span className="muted small">{t('fans.custom')}</span>
          <Toggle
            label={t('fans.customLabel')}
            checked={enabled}
            disabled={busy.has('setFanCurvesEnabled')}
            onChange={async (v) => {
              await act({ type: 'setFanCurvesEnabled', profile, enabled: v })
              await load()
            }}
          />
        </>
      }
    >
      <div className="toolbar">
        <Segmented
          label={t('fans.group')}
          value={current.fan}
          options={curves.map((c) => ({
            value: c.fan,
            label: `${t('live.fan', { name: fanName(t, c.fan) })}${dirtyFans.includes(c.fan) ? ' •' : ''}`
          }))}
          onChange={setFan}
        />
        <div className="toolbar-right">
          <Button
            icon="reset"
            onClick={async () => {
              await act({ type: 'resetFanCurves', profile }, t('fans.resetDone', { profile: profileName(t, profile) }))
              setEdits({})
              await load()
            }}
            disabled={busy.has('resetFanCurves')}
          >
            {t('fans.defaults')}
          </Button>
          <Button onClick={() => setEdits({})} disabled={!dirtyFans.length}>
            {t('fans.discard')}
          </Button>
          <Button kind="primary" onClick={apply} disabled={!dirtyFans.length || !!error || busy.has('setFanCurve')}>
            {dirtyFans.length > 1 ? t('fans.applyN', { n: dirtyFans.length }) : t('fans.apply')}
          </Button>
        </div>
      </div>
      <FanCurveEditor
        label={t('fans.curveLabel', { fan: fanName(t, current.fan), profile: profileName(t, profile) })}
        curve={edited}
        saved={current}
        liveTemp={isActive ? liveTemp : null}
        onChange={(c) => setEdits((e) => ({ ...e, [current.fan]: c }))}
      />
      {error && <Note kind="warn">{curveErrorText(t, error)}</Note>}
      {!enabled && !dirtyFans.length && <p className="muted small">{t('fans.firmwareNote')}</p>}
      {!isActive && <p className="muted small">{t('fans.otherProfile', { profile: profileName(t, profile) })}</p>}
    </Card>
  )
}

function PowerCard({ profile, isActive }: { profile: number; isActive: boolean }): ReactNode {
  const { snap, act, busy } = useStore()
  const t = useT()
  const ppt = useMemo(() => {
    // Keep the logical SPL → sPPT → fPPT → NVIDIA order rather than alphabetical.
    const order = [...PPT_ATTRS]
    return (snap?.armoury.filter((a) => PPT_ATTRS.has(a.id)) ?? []).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  }, [snap?.armoury])
  const other = useMemo(
    () => snap?.armoury.filter((a) => armouryMeta(a.id).group === 'power' && !PPT_ATTRS.has(a.id)) ?? [],
    [snap?.armoury]
  )
  if (!snap?.platform || (!ppt.length && !other.length)) return null
  const group = snap.platform.pptGroup
  const fansCustom = snap.fans?.some((c) => c.enabled) ?? false

  return (
    <Card
      title={t('power.title')}
      icon="bolt"
      className="span-2"
      actions={
        isActive && (
          <>
            <span className="muted small">{t('power.custom')}</span>
            <Toggle
              label={t('power.customLabel')}
              checked={group}
              disabled={busy.has('platform:EnablePptGroup')}
              onChange={(v) => act({ type: 'setPlatform', prop: 'EnablePptGroup', value: v })}
            />
          </>
        )
      }
    >
      {!isActive ? (
        <p className="muted">{t('power.inactive', { profile: profileName(t, profile) })}</p>
      ) : (
        <>
          {!group && (
            <Note>
              {t('power.enableNote', { profile: profileName(t, profile) })}
              {snap.fans && !fansCustom && ` ${t('power.needsFans')}`}
            </Note>
          )}
          {ppt.map((a) => {
            const m = armouryMeta(a.id)
            const label = attrLabel(t, a.id, a.displayName)
            return (
              <Row key={a.id} label={label} hint={attrDescription(t, a.id, a.displayName)}>
                <Slider
                  label={label}
                  value={a.current}
                  min={a.min}
                  max={a.max}
                  step={a.step > 0 ? a.step : 1}
                  unit={m.unit ? ` ${m.unit}` : ''}
                  disabled={!group || busy.has(`armoury:${a.id}`)}
                  marks={[a.default]}
                  onCommit={(v) => act({ type: 'setArmoury', id: a.id, value: v })}
                />
              </Row>
            )
          })}
        </>
      )}
      {other.map((a) => {
        const m = armouryMeta(a.id)
        return (
          <Row key={a.id} label={attrLabel(t, a.id, a.displayName)} hint={attrDescription(t, a.id, a.displayName)}>
            <span className="chip">
              {a.current}
              {m.unit}
            </span>
          </Row>
        )
      })}
    </Card>
  )
}
