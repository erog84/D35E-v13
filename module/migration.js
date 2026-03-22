export const migrateActor = async function(a) {
  try {

    let itemsToAdd = []
    const updateData = await migrateActorData(a, itemsToAdd);
    //game.D35E.logger.log(`Migrating Actor entity ${a.name}`);
    await a.update(updateData);
    //game.D35E.logger.log(`Adding missing items to ${a.name}`);
    if (itemsToAdd.length)
      await a.createEmbeddedDocuments("Item", itemsToAdd, {stopUpdates: true});
  } catch (err) {
    game.D35E.logger.error(err);
  }
}

export const migrateItem = async function(i) {
  try {
    const updateData = await migrateItemData(i);
    await i.update(updateData);
  } catch (err) {
    game.D35E.logger.error(err);
  }
}


/**
 * Perform a system migration for the entire World, applying migrations for Actors, Items, and Compendium packs
 * @return {Promise}      A Promise which resolves once the migration is completed
 */
export const migrateWorld = async function() {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  ui.notifications.info(`Applying D35E System Migration for version ${game.system.version}. Please stand by.`);
  //game.D35E.logger.log(`Applying D35E System Migration for version ${game.system.version}. Please stand by.`);

  // Migrate World Actors
  for ( let a of game.actors.contents ) {
    await migrateActor(a);
  }

  // Migrate World Items
  for ( let i of game.items.contents ) {
    try {
      const updateData = migrateItemData(i);
      //game.D35E.logger.log(`Migrating Item entity ${i.name}`);
      await i.update(updateData, {enforceTypes: false});
    } catch(err) {
      game.D35E.logger.error(err);
    }
  }

  game.D35E.logger.log("Migrating Scene documents.");
  for (const s of game.scenes.contents) {
    try {
      const updateData = migrateSceneData(s);
      if (!foundry.utils.isEmpty(updateData)) {
        game.D35E.logger.log(`Migrating Scene document ${s.name}`);
        await s.update(updateData, { enforceTypes: false });
        // If we do not do this, then synthetic token actors remain in cache
        // with the un-updated actorData.
        s.tokens.contents.forEach((t) => {
          t._actor = null;
        });
      }
    } catch (err) {
      game.D35E.logger.error(`Error migrating scene document ${s.name}`, err);
    }
  }


  // Migrate World Compendium Packs
  const packs = game.packs.filter(p => {
    return (p.metadata.package === "world") && ["Actor", "Item", "Scene"].includes(p.documentName)
  });
  for ( let p of packs ) {
    await migrateCompendium(p);
  }

  // Set the migration as complete
  game.settings.set("D35E", "systemMigrationVersion", game.system.version);
  ui.notifications.info(`D35E System Migration to version ${game.system.version} succeeded!`);
};

/* -------------------------------------------- */

/**
 * Apply migration rules to all Entities within a single Compendium pack
 * @param pack
 * @return {Promise}
 */
export const migrateCompendium = async function(pack) {
  const entity = pack.documentName;
  if ( !["Actor", "Item", "Scene"].includes(entity) ) return;
  let content = []
  try {
    // Begin by requesting server-side data model migration and get the migrated content
    await pack.migrate();
    content = await pack.getDocuments();
  } catch(err) {
    ui.notifications.error(game.i18n.localize("D35E.ErrorProblemWithMigratingPack") + pack.collection);
    game.D35E.logger.error(err);
  }

  game.D35E.logger.log(`Starting migration of ${pack.collection}`)
  // Iterate over compendium entries - applying fine-tuned migration functions
  for ( let ent of content ) {
    try {
      let updateData = null;
      if (entity === "Item") await migrateItem(ent);
      else if (entity === "Actor") await migrateActor(ent)
      else if ( entity === "Scene" ) updateData = await migrateSceneData(ent);

      //game.D35E.logger.log(`Migrated ${entity} entity ${ent.name} in Compendium ${pack.collection}`);
    } catch(err) {
      game.D35E.logger.error(err);
    }
  }
  game.D35E.logger.log(`Migrated all ${entity} entities from Compendium ${pack.collection}`);
};

/* -------------------------------------------- */
/*  Entity Type Migration Helpers               */
/* -------------------------------------------- */


/**
 * Migrate a single Actor entity to incorporate latest data model changes
 * Return an Object of updateData to be applied
 * @param {Actor} actor   The actor to Update
 * @return {Object}       The updateData to apply
 */
export const migrateActorData = async function(actor, itemsToAdd) {
  const updateData = {};
  _migrateCharacterLevel(actor, updateData);
  _migrateActorEncumbrance(actor, updateData);
  _migrateActorDefenseNotes(actor, updateData);
  _migrateActorSpeed(actor, updateData);
  _migrateSpellDivineFocus(actor, updateData);
  _migrateActorSpellbookSlots(actor, updateData);
  _migrateActorBaseStats(actor, updateData);
  _migrateActorCreatureType(actor, updateData);
  _migrateActorSpellbookDCFormula(actor, updateData);
  _migrateActorRace(actor, updateData)
  _migrateActorTokenVision(actor, updateData);
  _migrateActorSkillRanksToPoints(actor, updateData);
  await _migrateWeaponProficiencies(actor,updateData,itemsToAdd)
  await _migrateArmorProficiencies(actor,updateData,itemsToAdd)

  if (!actor.items) return updateData;
  const items = actor.items.reduce((arr, i) => {
    // Migrate the Owned Item
    const itemData = i instanceof CONFIG.Item.documentClass ? i.toObject() : i;
    const itemUpdate = migrateItemData(itemData);

    // Update the Owned Item
    if (!foundry.utils.isEmpty(itemUpdate)) {
      itemUpdate._id = itemData._id;
      arr.push(expandObject(itemUpdate));
    }

    return arr;
  }, []);
  if (items.length > 0) updateData.items = items;
  return updateData;

};

/* -------------------------------------------- */

/**
 * Migrate a single Item entity to incorporate latest data model changes
 * @param item
 */
export const migrateItemData = function(item) {
  const updateData = {};

  _migrateIcon(item, updateData);
  _migrateItemSpellUses(item, updateData);
  _migrateWeaponDamage(item, updateData);
  _migrateWeaponImprovised(item, updateData);
  _migrateSpellDescription(item, updateData);
  _migrateItemDC(item, updateData);
  _migrateClassDynamics(item, updateData);
  _migrateClassType(item, updateData);
  _migrateWeaponCategories(item, updateData);
  _migrateEquipmentCategories(item, updateData);
  _migrateWeaponSize(item, updateData);
  _migrateContainer(item, updateData);
  _migrateEnhancement(item, updateData);
  _migrateSpellName(item, updateData);
  _migrateClassSpellbook(item, updateData);
  _migrateSpellDuration(item, updateData);

  // Return the migrated update data
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Scene document to incorporate changes to the data model of it's actor data overrides
 * Return an Object of updateData to be applied
 *
 * @param {object} scene - The Scene to Update
 * @returns {object} The updateData to apply
 */
 export const migrateSceneData = function (scene) {
  const tokens = scene.tokens.map((token) => {
    const t = token.toJSON();
    if (!t.actorId || t.actorLink) {
      t.delta = {};
    } else if (!game.actors.has(t.actorId)) {
      t.actorId = null;
      t.delta = {};
    } else if (!t.actorLink) {
      const actorData = {};
      actorData.type = token.actor?.type;
      actorData.system = duplicate(t.delta || {})
      const update = migrateActorData(actorData, token);
      ["items", "effects"].forEach((embeddedName) => {
        if (!update[embeddedName]?.length) return;
        const updates = new Map(update[embeddedName].map((u) => [u._id, u]));
        (t.delta?.[embeddedName] || []).forEach((original) => {
          const update = updates.get(original._id);
          if (update) foundry.utils.mergeObject(original, update);
        });
        delete update[embeddedName];
      });

      foundry.utils.mergeObject(t.delta || {}, update);
    }
    return t;
  });
  return { tokens };
};



const _migrateActorTokenVision = function(ent, updateData) {
  const vision = getProperty(ent, "system.attributes.vision");
  if (!vision) return;

  updateData["system.attributes.-=vision"] = null;
  updateData["prototypeToken.flags.D35E.lowLightVision"] = vision.lowLight;
  if (!getProperty(ent, "prototypeToken.brightSight")) updateData["prototypeToken.brightSight"] = vision.darkvision;
};

const _migrateActorSkillRanksToPoints = function(ent, updateData) {
  
  for (let [sklKey, skl] of Object.entries(ent.system?.skills || {})) {
    if (skl.points !== undefined) continue;
    updateData[`system.skills.${sklKey}.points`] = skl.rank;
    for (let [subSklKey, subSkl] of Object.entries(skl.subSkills || {})) {
      if (subSkl.points !== undefined) continue;
      updateData[`system.skills.${sklKey}.subSkills.${subSklKey}.points`] = subSkl.rank; 
    }
}

  let data = duplicate(ent.system?.details?.levelUpData || []);
  if (data) {
    data.forEach(a => {
      for (let skill of Object.entries(a.skills || {})) {
        if (skill[1].points !== undefined) continue;
        skill[1].points = skill[1].rank
        if (skill[1].subskills) {
          for (let skl of Object.entries(skill[1].subskills || {})) {
            if (skl[1].points !== undefined) continue;
            skl[1].points = skl[1].rank
          }
        }
      }
    })
    updateData[`system.details.levelUpData`] = data;
  }
};

const migrateTokenVision = function(token, updateData) {
  if (!token.actor) return;

  setProperty(updateData, "flags.D35E.lowLightVision", getProperty(token.actor, "prototypeToken.flags.D35E.lowLightVision"));
  setProperty(updateData, "brightSight", getProperty(token.actor, "prototypeToken.brightSight"));
};



/* -------------------------------------------- */
/*  Low level migration utilities
/* -------------------------------------------- */

/**
 * Migrate string format traits with a comma separator to an array of strings
 * @private
 */
const _migrateActorTraits = function(actor, updateData) {
  if ( !actor.system?.traits ) return;
  const dt = invertObject(CONFIG.D35E.damageTypes);
  const map = {
    "dr": dt,
    "di": dt,
    "dv": dt,
    "ci": invertObject(CONFIG.D35E.conditionTypes),
    "languages": invertObject(CONFIG.D35E.languages)
  };
  for ( let [t, choices] of Object.entries(map) ) {
    const trait = actor.system.traits[t];
    if ( trait && (typeof trait.value === "string") ) {
      updateData[`system.traits.${t}.value`] = trait.value.split(",").map(t => choices[t.trim()]).filter(t => !!t);
    }
  }
};

/* -------------------------------------------- */


/**
 * Flatten several attributes which currently have an unnecessarily nested {value} object
 * @private
 */
const _migrateFlattenValues = function(ent, updateData, toFlatten) {
  for ( let a of toFlatten ) {
    const attr = getProperty(ent, a);
    if ( attr instanceof Object && !updateData.hasOwnProperty("system."+a) ) {
      updateData["system."+a] = attr.hasOwnProperty("value") ? attr.value : null;
    }
  }
};

const _migrateAddValues = function(ent, updateData, toAdd) {
  for (let [k, v] of Object.entries(toAdd)) {
    const attr = getProperty(ent, k);
    if (!attr && !updateData.hasOwnProperty(k)) {
      updateData[k] = v;
    }
  }
};

/* -------------------------------------------- */

const _migrateCharacterLevel = function(ent, updateData) {
  const arr = ["details.level.value", "details.level.min", "details.level.max"];
  for (let k of arr) {
    const value = getProperty(ent.system, k);
    if (value == null) {
      updateData["system."+k] = 0;
    }
  }
  let k = "details.levelUpProgression"
  const value = getProperty(ent.system, k);
  //game.D35E.logger.log(`Migrate | Level up progression ${value}`)
  if (value === null || value === undefined) {

    updateData["system.details.levelUpProgression"] = false;
  }
};

const _migrateActorEncumbrance = function(ent, updateData) {
  const arr = ["attributes.encumbrance.level", "attributes.encumbrance.levels.light",
  "attributes.encumbrance.levels.medium", "attributes.encumbrance.levels.heavy",
  "attributes.encumbrance.levels.carry", "attributes.encumbrance.levels.drag",
  "attributes.encumbrance.carriedWeight"];
  for (let k of arr) {
    const value = getProperty(ent.system, k);
    if (value == null) {
      updateData["system."+k] = 0
    }
  }
};

const _migrateWeaponProficiencies = async function(actor, updateData, itemsToAdd) {
  if (!itemsToAdd) return;
  let weaponProfItemId = "F7ouXcMvMxDFNq8S";
  let martialWeaponProfItemId = "L6Zih954XajPhxk0";
  let simpleWeaponProfItemId = "5jR5ehCRndtJpCGb";
  let pack = game.packs.get("D35E.feats");
  if (!(actor instanceof Actor)) return;
  let data = actor.system;
  if (data.traits && data.traits.weaponProf && data.traits.weaponProf.value) {
    if (data.traits.weaponProf.value.indexOf("sim") !== -1) {
      let item = await pack.getDocument(simpleWeaponProfItemId)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.weaponProf.value.indexOf("mar") !== -1) {
      let item = await pack.getDocument(martialWeaponProfItemId)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    updateData["system.traits.weaponProf.value"] = [];
  }
  if (data.traits && data.traits.weaponProf && data.traits.weaponProf.custom) {
    let weaponProfsCustom =  data.traits.weaponProf.custom.split(";");
    for (const weaponName of weaponProfsCustom) {
      let item = await pack.getDocument(weaponProfItemId)
      let data = duplicate(item.data);
      delete data._id;
      data.system.customAttributes["_87nolel8u"].value = weaponName
      data.name = data.system.nameFormula.replace("${this.custom.weaponname}",weaponName)
      itemsToAdd.push(data);
    }
    updateData["system.traits.weaponProf.custom"] = '';
  }
}

const _migrateArmorProficiencies = async function(actor, updateData, itemsToAdd) {
  if (!itemsToAdd) return;
  let spr = "AfSyZ6BqEOyyDzBD"
  let sprTower = "L2aYtdPHUaGH8UPE"
  let armProfLight = "tflks0QMIbzAyEle"
  let armProfMed = "ZwIMzns2opN6xxIo"
  let armProfHeavy = "sh3SLeHp45GMtm3n"
  let pack = game.packs.get("D35E.feats");
  if (!(actor instanceof Actor)) return;
  let data = actor.system;
  if (data.traits && data.traits.weaponProf && data.traits.armorProf.value) {
    if (data.traits.armorProf.value.indexOf("twr") !== -1) {
      let item = await pack.getDocument(sprTower)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("shl") !== -1) {
      let item = await pack.getDocument(spr)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("lgt") !== -1) {
      let item = await pack.getDocument(armProfLight)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("med") !== -1) {
      let item = await pack.getDocument(armProfMed)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("hvy") !== -1) {
      let item = await pack.getDocument(armProfHeavy)
      let data = duplicate(item.toObject());
      delete data._id;
      itemsToAdd.push(data);
    }
    updateData["system.traits.armorProf.value"] = [];
  }

}


const _migrateActorRace = function(actor, updateData) {
  // if (!(actor instanceof Actor)) return;
  // if (actor.race == null) return;
  //
  // if (item.type === "race") {
  //   actor.race.update(item);
  //   return false;
  // }
}


const _migrateActorDefenseNotes = function(ent, updateData) {
  const arr = ["attributes.acNotes", "attributes.cmdNotes", "attributes.srNotes"];
  for (let k of arr) {
    const value = getProperty(ent.system, k);
    if (value == null) {
      updateData["system."+k] = "";
    }
  }
};

const _migrateActorSpeed = function(ent, updateData) {
  const arr = ["attributes.speed.land", "attributes.speed.climb", "attributes.speed.swim", "attributes.speed.fly", "attributes.speed.burrow"];
  for (let k of arr) {
    let value = getProperty(ent.system, k);
    if (typeof value === "string") value = parseInt(value);
    if (typeof value === "number") {
      updateData[`system.${k}.base`] = value;
      updateData[`system.${k}.total`] = value;
    }
    else if (value == null) {
      updateData[`system.${k}.base`] = 0;
      updateData[`system.${k}.total`] = null;
    }

    // Add maneuverability
    if (k === "attributes.speed.fly" && getProperty(ent.system, `${k}.maneuverability`) === undefined) {
      updateData[`system.${k}.maneuverability`] = "average";
    }
  }
};

const _migrateActorSpellbookSlots = function(ent, updateData) {
  for (let spellbookSlot of Object.keys(getProperty(ent.system, "attributes.spells.spellbooks") || {})) {
    if (getProperty(ent.system, `attributes.spells.spellbooks.${spellbookSlot}.autoSpellLevels`) == null) {
      updateData[`system.attributes.spells.spellbooks.${spellbookSlot}.autoSpellLevels`] = true;
    }

    for (let a = 0; a < 10; a++) {
      const baseKey = `system.attributes.spells.spellbooks.${spellbookSlot}.spells.spell${a}.base`;
      const maxKey = `system.attributes.spells.spellbooks.${spellbookSlot}.spells.spell${a}.max`;
      const base = getProperty(ent, baseKey);
      const max = getProperty(ent, maxKey);
      if (base === undefined && typeof max === "number" && max > 0) {
        updateData[baseKey] = max.toString();
      }
      else if (base === undefined) {
        updateData[baseKey] = "";
      }
    }
  }
};

const _migrateActorBaseStats = function(ent, updateData) {
  const keys = ["attributes.hp.base", "attributes.hd.base", "attributes.savingThrows.fort.value",
    "attributes.savingThrows.ref.value", "attributes.savingThrows.will.value"];
  for (let k of keys) {
    if (k === "attributes.hp.base" && !(getProperty(ent, "items") || []).filter(o => o.type === "class")?.length) continue;
    if (getProperty(ent.system, k) != null) {
      let kList = k.split(".");
      kList[kList.length-1] = `-=${kList[kList.length-1]}`;
      updateData[`system.${kList.join(".")}`] = null;
    }
  }

  if (getProperty(ent, "system.attributes.conditions.wildshaped") == null) {
    updateData["system.attributes.conditions.wildshaped"] = false;
  }

  if (getProperty(ent, "system.attributes.conditions.polymorphed") == null) {
    updateData["system.attributes.conditions.polymorphed"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.prone") == null) {
    updateData["system.attributes.conditions.prone"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.dead") == null) {
    updateData["system.attributes.conditions.dead"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.dying") == null) {
    updateData["system.attributes.conditions.dying"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.disabled") == null) {
    updateData["system.attributes.conditions.disabled"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.stable") == null) {
    updateData["system.attributes.conditions.stable"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.staggered") == null) {
    updateData["system.attributes.conditions.staggered"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.unconscious") == null) {
    updateData["system.attributes.conditions.unconscious"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.invisibility")) {
    updateData["system.attributes.conditions.invisibility"] = null;
  }
  if (getProperty(ent, "system.attributes.conditions.invisible") == null) {
    updateData["system.attributes.conditions.invisible"] = false;
  }
  if (getProperty(ent, "system.attributes.conditions.banished") == null) {
    updateData["system.attributes.conditions.banished"] = false;
  }


};

const _migrateActorCreatureType = function(ent, updateData) {
  if (getProperty(ent, "system.attributes.creatureType") == null) {
    updateData["system.attributes.creatureType"] = "humanoid";
  }
};

const _migrateActorSpellbookDCFormula = function(ent, updateData) {
  const spellbooks = Object.keys(getProperty(ent, "system.attributes.spells.spellbooks") || {});

  for (let k of spellbooks) {
    const key = `system.attributes.spells.spellbooks.${k}.baseDCFormula`;
    const curFormula = getProperty(ent, key);
    if (curFormula == null) updateData[key] = "10 + @sl + @ablMod";
  }
};

const _migrateIcon = function(ent, updateData) {
  const value = getProperty(ent, "img") || "";
  if (value.endsWith("/con.png")) updateData["img"] = value.replace("/con.png","/con_.png");
};

const _migrateItemSpellUses = function(ent, updateData) {
  if (getProperty(ent.system, "preparation") === undefined) return;

  const value = getProperty(ent.system, "preparation.maxAmount");
  if (typeof value !== "number") updateData["system.preparation.maxAmount"] = 0;
};

const _migrateWeaponDamage = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  const value = getProperty(ent.system, "weaponData");
  if (typeof value !== "object") {
    updateData["system.weaponData"] = {};
    updateData["system.weaponData.critRange"] = 20;
    updateData["system.weaponData.critMult"] = 2;
  }

  if (getProperty(ent, "system.threatRangeExtended") == null) {
    updateData["system.threatRangeExtended"] = false;
  }
  if (getProperty(ent, "system.finesseable") == null) {
    updateData["system.finesseable"] = false;
  }
};

const _migrateEnhancement = function(ent, updateData) {
  if (ent.type !== "weapon" || ent.type !== "equipment" ) return;

  const value = getProperty(ent.system, "enhancement");
  if (typeof value !== "object") {
    updateData["system.enhancement"] = {};
    updateData["system.enhancement.items"] = [];
    updateData["system.enhancement.uses"] = {
          "value": 0,
          "max": 0,
          "per": null,
          "autoDeductCharges": true,
          "allowMultipleUses": false
    };
  }
};

const _migrateWeaponImprovised = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  const value = getProperty(ent.system, "weaponType");
  if (value === "improv") {
    updateData["system.weaponType"] = "misc";
    updateData["system.properties.imp"] = true;
  }
};

const _migrateSpellName = function(ent, updateData) {
  if (ent.type !== "spell") return;
  updateData["name"] = (ent.name || "").trim()
}

const _migrateSpellDuration = function(ent, updateData) {
  if (ent.type !== "spell") return;
  let duration = (getProperty(ent.system, "spellDuration") || "").toLowerCase().trim()
  if (!duration)
    return;
  let newDurationUnits = "spec"
  let value = parseInt(duration) || "";
  if (isNaN(value) || !value)
    value = "";
  let dismissable = false;
  if (duration.indexOf("(d)") !== -1) {
    dismissable = true;
  }

  function __updateValuePerLevel() {
    if (value === "1") {
      value = "@cl"
    } else {
      value = value + "*@cl"
    }
  }

  if (duration.indexOf("concentration") !== -1) {
    newDurationUnits = "spec"
    value = getProperty(ent.system, "spellDuration").replace("(D)","").trim();
  }
  else if (duration.indexOf("until discharged") !== -1) {
    newDurationUnits = "spec"
    value = getProperty(ent.system, "spellDuration").replace("(D)","").trim();
  }
  else if (duration.indexOf("see text") !== -1) {
    newDurationUnits = "seeText"
  }
  else if (duration.indexOf("round/level") !== -1) {
    newDurationUnits = "roundPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("rounds/level") !== -1) {
    newDurationUnits = "roundPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("hour/level") !== -1) {
    newDurationUnits = "hourPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("hours/level") !== -1) {
    newDurationUnits = "hourPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("minute/level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("minutes/level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("min./level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("rounds") !== -1) {
    newDurationUnits = "rounds"
  }
  else if (duration.indexOf("turns") !== -1) {
    newDurationUnits = "turns"
  }
  else if (duration.indexOf("hour") !== -1) {
    newDurationUnits = "hour"
  }
  else if (duration.indexOf("hour") !== -1) {
    newDurationUnits = "hour"
  }
  else if (duration.indexOf("day") !== -1) {
    newDurationUnits = "days"
  }
  else if (duration.indexOf("days") !== -1) {
    newDurationUnits = "days"
  }
  else if (duration.indexOf("instantaneous") !== -1) {
    newDurationUnits = "inst"
  }
  else if (duration.indexOf("permanent") !== -1) {
    newDurationUnits = "perm"
  }

  const oldValue = getProperty(ent.system, "spellDurationData.units");
  if (!oldValue || true) {
    updateData["system.spellDurationData"] = {value: value, units: newDurationUnits, dismissable: dismissable}
  }

}


const _migrateClassSpellbook = function(ent, updateData) {
  if (ent.type !== "class") return;
  const curValue = getProperty(ent.system, "spellbook");
  if (curValue != null || (curValue?.length || 0) > 0) return;
  let spellbook = []
  for (let a = 0; a < 10; a++) {
    spellbook.push({level: a, spells: []})
  }
  updateData["system.spellbook"] = spellbook;
}

const _migrateSpellDescription = function(ent, updateData) {
  if (ent.type !== "spell") return;

  const curValue = getProperty(ent.system, "shortDescription");
  if (curValue != null) return;

  const obj = getProperty(ent.system, "description.value");
  if (typeof obj !== "string") return;
  const html = $(`<div>${obj}</div>`);
  const elem = html.find("h2").next();
  if (elem.length === 1) updateData["system.shortDescription"] = elem.prop("outerHTML");
  else updateData["system.shortDescription"] = html.prop("innerHTML");
};

const _migrateSpellDivineFocus = function(ent, updateData) {
  if (ent.type !== "spell") return;

  const value = getProperty(ent.system, "components.divineFocus");
  if (typeof value === "boolean") updateData["system.components.divineFocus"] = (value === true ? 1 : 0);
};

const _migrateItemDC = function(ent, updateData) {
  // const value = getProperty(ent.system, "save.type");
  // if (value == null) return;
  // if (value === "") updateData["system.save.description"] = "";
  // else if (value === "fort") updateData["system.save.description"] = "Fortitude partial";
  // else if (value === "ref") updateData["system.save.description"] = "Reflex half";
  // else if (value === "will") updateData["system.save.description"] = "Will negates";
  // updateData["system.save.-=type"] = null;
};

const _migrateClassDynamics = function(ent, updateData) {
  if (ent.type !== "class") return;

  const bab = getProperty(ent.system, "bab");
  if (typeof bab === "number") updateData["system.bab"] = "low";

  const stKeys = ["system.savingThrows.fort.value", "system.savingThrows.ref.value", "system.savingThrows.will.value"];
  for (let key of stKeys) {
    let value = getProperty(ent, key);
    if (typeof value === "number") updateData[key] = "low";
  }
};

const _migrateClassType = function(ent, updateData) {
  if (ent.type !== "class") return;

  if (getProperty(ent.system, "classType") == null) updateData["system.classType"] = "base";


  if (getProperty(ent.system, "powersKnown" === null)) {
    let powersKnown = {}
    for (let i = 1; i <= 20; i++) {
      powersKnown[i] = 0;
    }
    updateData["system.powersKnown"] = powersKnown
  }
  if (getProperty(ent.system, "powerPointTable" === null)) {
    let powerPointTable = {}
    for (let i = 1; i <= 20; i++) {
      powerPointTable[i] = 0;
    }
    updateData["system.powerPointTable"] = powerPointTable
  }
  if (getProperty(ent.system, "powersMaxLevel" === null)) {
    let powersMaxLevel = {}
    for (let i = 1; i <= 20; i++) {
      powersMaxLevel[i] = 0;
    }
    updateData["system.powersMaxLevel"] = powersMaxLevel
  }
};

const _migrateWeaponCategories = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  // Change category
  const type = getProperty(ent.system, "weaponType");
  if (type === "misc") {
    updateData["system.weaponType"] = "misc";
    updateData["system.weaponSubtype"] = "other";
  }
  else if (type === "splash") {
    updateData["system.weaponType"] = "misc";
    updateData["system.weaponSubtype"] = "splash";
  }

  const changeProp = (["simple", "martial", "exotic"].includes(type));
  if (changeProp && getProperty(ent.system, "weaponSubtype") == null) {
    updateData["system.weaponSubtype"] = "1h";
  }

  // Change light property
  const lgt = getProperty(ent.system, "properties.lgt");
  if (lgt != null) {
    updateData["system.properties.-=lgt"] = null;
    if (lgt === true && changeProp) {
      updateData["system.weaponSubtype"] = "light";
    }
  }

  // Change two-handed property
  const two = getProperty(ent.system, "properties.two");
  if (two != null) {
    updateData["system.properties.-=two"] = null;
    if (two === true && changeProp) {
      updateData["system.weaponSubtype"] = "2h";
    }
  }

  // Change melee property
  const melee = getProperty(ent.system, "weaponData.isMelee");
  if (melee != null) {
    updateData["system.weaponData.-=isMelee"] = null;
    if (melee === false && changeProp) {
      updateData["system.weaponSubtype"] = "ranged";
    }
  }
};

const _migrateEquipmentCategories = function(ent, updateData) {
  if (ent.type !== "equipment") return;

  const oldType = getProperty(ent.system, "armor.type");
  if (oldType == null) return;

  if (oldType === "clothing") {
    updateData["system.equipmentType"] = "misc";
    updateData["system.equipmentSubtype"] = "clothing";
  }
  else if (oldType === "shield") {
    updateData["system.equipmentType"] = "shield";
    updateData["system.equipmentSubtype"] = "lightShield";
    updateData["system.slot"] = "shield";
  }
  else if (oldType === "misc") {
    updateData["system.equipmentType"] = "misc";
    updateData["system.equipmentSubtype"] = "wondrous";
  }
  else if (["light", "medium", "heavy"].includes(oldType)) {
    updateData["system.equipmentType"] = "armor";
    updateData["system.equipmentSubtype"] = `${oldType}Armor`;
  }

  updateData["system.armor.-=type"] = null;
};

const _migrateWeaponSize = function(ent, updateData) {
  if (ent.type !== "weapon") return;
  
  if (!getProperty(ent, "system.weaponData.size")) {
    updateData["system.weaponData.size"] = "med";
  }
};

const _migrateContainer = function(ent, updateData) {
  if (!getProperty(ent, "system.quantity")) return;

  if (!getProperty(ent, "system.container")) {
    updateData["system.container"] = "None";
    updateData["system.containerId"] = "none";
    updateData["system.containerWeightless"] = false;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string spell casting time like "1 Bonus Action" to separate fields for activation type and numeric cost
 * @private
 */
const _migrateCastTime = function(item, updateData) {
  const value = getProperty(item.data, "time.value");
  if ( !value ) return;
  const ATS = invertObject(CONFIG.D35E.abilityActivationTypes);
  let match = value.match(/([\d]+\s)?([\w\s]+)/);
  if ( !match ) return;
  let type = ATS[match[2]] || "none";
  let cost = match[1] ? Number(match[1]) : 0;
  if ( type === "none" ) cost = 0;
  updateData["system.activation"] = {type, cost};
};

/* -------------------------------------------- */
/*  General Migrations                          */
/* -------------------------------------------- */

/**
 * Migrate from a string based damage formula like "2d6 + 4 + 1d4" and a single string damage type like "slash" to
 * separated damage parts with associated damage type per part.
 * @private
 */
const _migrateDamage = function(item, updateData) {

  // Regular Damage
  let damage = item.system.damage;
  if ( damage && damage.value ) {
    let type = item.system.damageType ? item.system.damageType.value : "";
    const parts = damage.value.split("+").map(s => s.trim()).map(p => [p, type || null]);
    if ( item.type === "weapon" && parts.length ) parts[0][0] += " + @mod";
    updateData["system.damage.parts"] = parts;
    updateData["system.damage.-=value"] = null;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string duration field like "1 Minute" to separate fields for duration units and numeric value
 * @private
 */
const _migrateDuration = function(item, updateData) {
  const TIME = invertObject(CONFIG.D35E.timePeriods);
  const dur = item.system.duration;
  if ( dur && dur.value && !dur.units ) {
    let match = dur.value.match(/([\d]+\s)?([\w\s]+)/);
    if ( !match ) return;
    let units = TIME[match[2]] || "inst";
    let value = units === "inst" ? "" : Number(match[1]) || "";
    updateData["system.duration"] = {units, value};
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string range field like "150 ft." to separate fields for units and numeric distance value
 * @private
 */
const _migrateRange = function(item, updateData) {
  if ( updateData["system.range"] ) return;
  const range = item.system.range;
  if ( range && range.value && !range.units ) {
    let match = range.value.match(/([\d\/]+)?(?:[\s]+)?([\w\s]+)?/);
    if ( !match ) return;
    let units = "none";
    if ( /ft/i.test(match[2]) ) units = "ft";
    else if ( /mi/i.test(match[2]) ) units = "mi";
    else if ( /touch/i.test(match[2]) ) units = "touch";
    updateData["system.range.units"] = units;

    // Range value
    if ( match[1] ) {
      let value = match[1].split("/").map(Number);
      updateData["system.range.value"] = value[0];
      if ( value[1] ) updateData["system.range.long"] = value[1];
    }
  }
};

/* -------------------------------------------- */

const _migrateRarity = function(item, updateData) {
  const rar = item.system.rarity;
  if ( (rar instanceof Object) && !rar.value ) updateData["system.rarity"] = "Common";
  else if ( (typeof rar === "string") && (rar === "") ) updateData["system.rarity"] = "Common";
};

/* -------------------------------------------- */


/**
 * A general migration to remove all fields from the data model which are flagged with a _deprecated tag
 * @private
 */
const _migrateRemoveDeprecated = function(ent, updateData, toFlatten) {
  const flat = flattenObject(ent);

  // Deprecate entire objects
  const toDeprecate = Object.entries(flat).filter(e => e[0].endsWith("_deprecated") && (e[1] === true)).map(e => {
    let parent = e[0].split(".");
    parent.pop();
    return parent.join(".");
  });
  for ( let k of toDeprecate ) {
    let parts = k.split(".");
    parts[parts.length-1] = "-=" + parts[parts.length-1];
    updateData[`system.${parts.join(".")}`] = null;
  }

  // Deprecate types and labels
  for ( let [k, v] of Object.entries(flat) ) {
    let parts = k.split(".");
    parts.pop();

    // Skip any fields which have already been touched by other migrations
    if ( toDeprecate.some(f => k.startsWith(f) ) ) continue;
    if ( toFlatten.some(f => k.startsWith(f)) ) continue;
    if ( updateData.hasOwnProperty(`system.${k}`) ) continue;

    // Remove the data type field
    const dtypes = ["Number", "String", "Boolean", "Array", "Object"];
    if ( k.endsWith("type") && dtypes.includes(v) ) {
      updateData[`system.${k.replace(".type", ".-=type")}`] = null;
    }

    // Remove string label
    else if ( k.endsWith("label") ) {
      updateData[`system.${k.replace(".label", ".-=label")}`] = null;
    }
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a target string like "15 ft. Radius" to a more explicit data model with a value, units, and type
 * @private
 */
const _migrateTarget = function(item, updateData) {
  const target = item.system.target;
  if ( target.value && !Number.isNumeric(target.value) ) {

    // Target Type
    let type = null;
    for ( let t of Object.keys(CONFIG.D35E.targetTypes) ) {
      let rgx = new RegExp(t, "i");
      if ( rgx.test(target.value) ) {
        type = t;
        continue;
      }
    }

    // Target Units
    let units = null;
    if ( /ft/i.test(target.value) ) units = "ft";
    else if ( /mi/i.test(target.value) ) units = "mi";
    else if ( /touch/i.test(target.value) ) units = "touch";

    // Target Value
    let value = null;
    let match = target.value.match(/([\d]+)([\w\s]+)?/);
    if ( match ) value = Number(match[1]);
    else if ( /one/i.test(target.value) ) value = 1;
    updateData["system.target"] = {type, units, value};
  }
};

/* -------------------------------------------- */

/**
 * Migrate from string based components like "V,S,M" to boolean flags for each component
 * Move concentration and ritual flags into the components object
 * @private
 */
const _migrateSpellComponents = function(item, updateData) {
  const components = item.system.components;
  if ( !components.value ) return;
  let comps = components.value.toUpperCase().replace(/\s/g, "").split(",");
  updateData["system.components"] = {
    value: "",
    verbal: comps.includes("V"),
    somatic: comps.includes("M"),
    material: comps.includes("S"),
    concentration: item.system.concentration.value === true,
    ritual: item.system.ritual.value === true
  };
};

/* -------------------------------------------- */

/**
 * Migrate from a simple object with save.value to an expanded object where the DC is also configured
 * @private
 */
const _migrateSpellAction = function(item, updateData) {

  // Set default action type for spells
  if ( item.system.spellType ) {
    updateData["system.actionType"] = {
      "attack": "rsak",
      "save": "save",
      "heal": "heal",
      "utility": "util",
    }[item.system.spellType.value] || "util";
  }

  // Spell saving throw
  const save = item.system.save;
  if ( !save.value ) return;
  updateData["system.save"] = {
    ability: save.value,
    dc: null
  };
  updateData["system.save.-=value"] = null;
};

/* -------------------------------------------- */

/**
 * Migrate spell preparation data to the new preparation object
 * @private
 */
const _migrateSpellPreparation = function(item, updateData) {
  const prep = item.system.preparation;
  if ( prep && !prep.mode ) {
    updateData["system.preparation.mode"] = "prepared";
    updateData["system.preparation.prepared"] = item.system.prepared ? Boolean(item.system.prepared.value) : false;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string based weapon properties like "Heavy, Two-Handed" to an object of boolean flags
 * @private
 */
const _migrateWeaponProperties = function(item, updateData) {

  // Set default activation mode for weapons
  updateData["system.activation"] = {type: "action", cost: 1};

  // Set default action type for weapons
  updateData["system.actionType"] = {
    "simpleM": "mwak",
    "simpleR": "rwak",
    "martialM": "mwak",
    "martialR": "rwak",
    "natural": "mwak",
    "improv": "mwak",
    "ammo": "rwak"
  }[item.system.weaponType.value] || "mwak";

  // Set default melee weapon range
  if ( updateData["system.actionType"] === "mwak" ) {
    updateData["system.range"] = {
      value: updateData["system.properties.rch"] ? 10 : 5,
      units: "ft"
    }
  }

  // Map weapon property strings to boolean flags
  const props = item.system.properties;
  if ( props.value ) {
    const labels = invertObject(CONFIG.D35E.weaponProperties);
    for (let k of props.value.split(",").map(p => p.trim())) {
      if (labels[k]) updateData[`system.properties.${labels[k]}`] = true;
    }
    updateData["system.properties.-=value"] = null;
  }
};

const migrateTokenStatuses = function (token, updateData) {
  if (!token.actor) return;

  if ((token.effects || []).length) {
    var effects = token.effects || [];
    effects = effects.filter((e) => {
      const [key, tex] = Object.entries(CONFIG.D35E.conditionTextures).find((t) => e === t[1]) ?? [];
      if (key && token.actor.system.attributes.conditions[key]) return false;
      if (token.actor.items.find((i) => i.type === "buff" && i.system.active && i.img === e)) return false;
      return true;
    });
  }
  setProperty(updateData, "effects", effects);
};

